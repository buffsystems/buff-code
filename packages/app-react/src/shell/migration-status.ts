// The bundled server's data migration (#584), the Solid desktop MigrationStatus: a second after
// start the status is read every second; while it runs a persistent «label n/m» toast shows, it
// goes when the migration completes, and a failure is reported once.

import type { MigrationV1StatusOutput } from "@opencode/client/promise"

type Progress = Extract<MigrationV1StatusOutput, { status: "running" }>["progress"]

export function migrationLabel(progress: Progress | undefined) {
  if (!progress) return ""
  if (progress.numerator === undefined) return progress.label
  if (progress.denominator === undefined) return `${progress.label} ${progress.numerator}`
  return `${progress.label} ${progress.numerator}/${progress.denominator}`
}

export async function watchMigration(input: {
  status: (signal: AbortSignal) => Promise<MigrationV1StatusOutput>
  signal: AbortSignal
  wait: (ms: number, signal: AbortSignal) => Promise<void>
  progress: (label: string | undefined) => void
  fail: (message: string) => void
}) {
  await input.wait(1_000, input.signal)
  try {
    while (!input.signal.aborted) {
      const status = await input.status(input.signal)
      if (status.status === "running") input.progress(migrationLabel(status.progress))
      else input.progress(undefined)
      if (status.status === "completed") return
      if (status.status === "error") throw new Error(status.error)
      await input.wait(1_000, input.signal)
    }
  } catch (error) {
    if (input.signal.aborted) return
    input.progress(undefined)
    input.fail(error instanceof Error ? error.message : String(error))
  }
}

export function abortableWait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
    function done() {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
  })
}
