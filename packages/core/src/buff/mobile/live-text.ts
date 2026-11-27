// Buff (#969): текст, который модель ещё пишет. Ядро хранит текст и размышления части целиком — по
// её окончании (`session.text.ended`); пока часть идёт, в хранилище она пустая, а фрагменты летят
// событиями (`session.text.delta`), которые не сохраняются. Окно складывает их само; телефон и
// веб-клиент видят сессию снимками состояния — и до этого получали ответ разом, в конце. Здесь
// фрагменты копятся по сообщению и подставляются в снимок: пустая часть получает написанное к
// этому моменту и отметку `streaming`. Закончилась часть — снова действует хранилище.

interface Data {
  sessionID?: unknown
  assistantMessageID?: unknown
  ordinal?: unknown
  delta?: unknown
}

const KINDS = ["text", "reasoning"] as const
type Kind = (typeof KINDS)[number]

export function liveText() {
  // сообщение → «вид:порядок» → написанное; у сообщения помним сессию, чтобы убрать с её остановкой.
  const parts = new Map<string, { session: string; written: Map<string, string> }>()
  const drop = (message: unknown) => void parts.delete(String(message))
  return {
    /** Событие шины; true — оно про пишущуюся часть (или её конец). */
    event(type: string, data: unknown): boolean {
      const d = (data ?? {}) as Data
      const found = /^session\.(text|reasoning)\.(started|delta|ended)$/.exec(type)
      if (found) {
        const key = `${found[1]}:${String(d.ordinal)}`
        const message = String(d.assistantMessageID)
        if (found[2] === "ended") {
          const held = parts.get(message)
          held?.written.delete(key)
          if (held && !held.written.size) parts.delete(message)
          return true
        }
        const held = parts.get(message) ?? { session: String(d.sessionID), written: new Map<string, string>() }
        parts.set(message, held)
        held.written.set(key, found[2] === "started" ? "" : (held.written.get(key) ?? "") + String(d.delta ?? ""))
        return true
      }
      if (type === "session.step.ended" || type === "session.step.failed") drop(d.assistantMessageID)
      if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(type))
        for (const [message, held] of parts) if (held.session === String(d.sessionID)) parts.delete(message)
      return false
    },
    /** Сообщения снимка с написанным к этому моменту; нечего подставлять — тот же список. */
    apply(messages: unknown[]): unknown[] {
      if (!parts.size) return messages
      let touched = false
      const next = messages.map((message) => {
        const m = message as { id?: unknown; content?: unknown } | null
        const held = parts.get(String(m?.id))
        if (!held || !Array.isArray(m?.content)) return message
        const seen: Record<Kind, number> = { text: 0, reasoning: 0 }
        const content = m.content.map((part: { type?: unknown; text?: unknown }) => {
          const kind = KINDS.find((known) => known === part?.type)
          if (!kind) return part
          const written = held.written.get(`${kind}:${seen[kind]++}`)
          // Что хранилище уже держит целиком, не трогаем.
          if (written === undefined || part.text) return part
          touched = true
          return { ...part, text: written, streaming: true }
        })
        return { ...(m as object), content }
      })
      return touched ? next : messages
    },
    size: () => parts.size,
  }
}
