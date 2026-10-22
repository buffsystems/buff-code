// The debug bar's window diagnostics (#584), the Solid debug bar's sampler as plain TS: frames per
// second, the worst frame and janky frames, long tasks, input delay and INP over the last five
// seconds, layout shift since start and the JS heap — paused while the window is hidden.

type Window5 = Array<{ at: number; dur: number }>
type EventTiming = PerformanceEntry & { interactionId?: number; processingStart?: number }
type LayoutShift = PerformanceEntry & { hadRecentInput: boolean; value: number }
type Memory = Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }

export type Diagnostics = {
  fps?: number
  gap?: number
  jank?: number
  long?: { block: number; count: number; max: number }
  delay?: number
  inp?: number
  cls?: number
  heap?: { used: number; limit: number }
}

const SPAN = 5000

const trim = (list: Window5, at: number) => {
  while (list[0] && at - list[0].at > SPAN) list.shift()
}

/** Frame figures of the last five seconds. */
export function frameStats(frames: Window5) {
  const total = frames.reduce((sum, entry) => sum + entry.dur, 0)
  const gap = frames.reduce((max, entry) => Math.max(max, entry.dur), 0)
  return {
    fps: total > 0 ? (frames.length * 1000) / total : undefined,
    gap: gap > 0 ? gap : undefined,
    jank: frames.filter((entry) => entry.dur > 32).length,
  }
}

/** Blocked time beyond 50ms per task, the task count and the longest task. */
export function longStats(tasks: Window5) {
  return {
    block: tasks.reduce((sum, entry) => sum + Math.max(0, entry.dur - 50), 0),
    count: tasks.length,
    max: tasks.reduce((max, entry) => Math.max(max, entry.dur), 0),
  }
}

export function createDiagnosticsSampler(update: (patch: Diagnostics) => void) {
  const observers: PerformanceObserver[] = []
  const frames: Window5 = []
  const tasks: Window5 = []
  const seen = new Map<number | string, { at: number; delay: number; dur: number }>()
  const state = { long: false, raf: 0, last: 0, snap: 0, poll: undefined as number | undefined, cls: 0 }

  const watch = (
    type: string,
    init: PerformanceObserverInit & { durationThreshold?: number },
    run: (entries: PerformanceEntry[]) => void,
  ) => {
    if (typeof PerformanceObserver === "undefined") return false
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes(type)) return false
    const observer = new PerformanceObserver((list) => run(list.getEntries()))
    try {
      observer.observe(init)
      observers.push(observer)
      return true
    } catch {
      observer.disconnect()
      return false
    }
  }
  const syncLong = (at = performance.now()) => {
    if (!state.long) return
    trim(tasks, at)
    update({ long: longStats(tasks) })
  }
  const syncInp = (at = performance.now()) => {
    for (const [key, entry] of seen) if (at - entry.at > SPAN) seen.delete(key)
    const values = [...seen.values()]
    const delay = Math.max(0, ...values.map((entry) => entry.delay))
    const inp = Math.max(0, ...values.map((entry) => entry.dur))
    update({ delay: delay > 0 ? delay : undefined, inp: inp > 0 ? inp : undefined })
  }
  const syncHeap = () => {
    const memory = (performance as Memory).memory
    if (memory) update({ heap: { used: memory.usedJSHeapSize, limit: memory.jsHeapSizeLimit } })
  }

  const shifts = watch("layout-shift", { buffered: true, type: "layout-shift" }, (entries) => {
    const add = entries.reduce(
      (sum, entry) => sum + ((entry as LayoutShift).hadRecentInput ? 0 : (entry as LayoutShift).value),
      0,
    )
    if (add === 0) return
    state.cls += add
    update({ cls: state.cls })
  })
  if (shifts) update({ cls: 0 })
  state.long = watch("longtask", { buffered: true, type: "longtask" }, (entries) => {
    tasks.push(...entries.map((entry) => ({ at: entry.startTime, dur: entry.duration })))
    syncLong()
  })
  if (state.long) update({ long: { block: 0, count: 0, max: 0 } })
  watch("event", { buffered: true, durationThreshold: 16, type: "event" }, (entries) => {
    for (const raw of entries) {
      const entry = raw as EventTiming
      if (entry.duration < 16) continue
      const key = entry.interactionId ? entry.interactionId : `${entry.name}:${Math.round(entry.startTime)}`
      const previous = seen.get(key)
      const delay = Math.max(0, (entry.processingStart ?? entry.startTime) - entry.startTime)
      seen.set(key, {
        at: entry.startTime,
        delay: Math.max(previous?.delay ?? 0, delay),
        dur: Math.max(previous?.dur ?? 0, entry.duration),
      })
      const first = seen.size > 200 ? seen.keys().next().value : undefined
      if (first !== undefined) seen.delete(first)
    }
    syncInp()
  })

  const loop = (at: number) => {
    if (document.visibilityState !== "visible") return void (state.raf = 0)
    if (state.last !== 0) frames.push({ at, dur: at - state.last })
    state.last = at
    if (at - state.snap >= 250) {
      state.snap = at
      trim(frames, at)
      update(frameStats(frames))
    }
    state.raf = requestAnimationFrame(loop)
  }
  const stop = () => {
    if (state.raf !== 0) cancelAnimationFrame(state.raf)
    state.raf = 0
    window.clearInterval(state.poll)
    state.poll = undefined
  }
  const start = () => {
    if (document.visibilityState !== "visible") return
    state.poll ??= window.setInterval(() => {
      syncLong()
      syncInp()
      syncHeap()
    }, 1000)
    if (state.raf === 0) state.raf = requestAnimationFrame(loop)
  }
  const visibility = () => {
    if (document.visibilityState !== "visible") return stop()
    frames.length = 0
    tasks.length = 0
    seen.clear()
    state.last = 0
    state.snap = 0
    update({ fps: undefined, gap: undefined, jank: undefined, delay: undefined, inp: undefined })
    start()
  }

  syncHeap()
  start()
  document.addEventListener("visibilitychange", visibility)
  return () => {
    stop()
    document.removeEventListener("visibilitychange", visibility)
    observers.forEach((observer) => observer.disconnect())
  }
}
