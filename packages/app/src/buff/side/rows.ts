/**
 * Лента побочного диалога (#464) без отрисовки: только сказанное после открытия — история до
 * него скопирована из основной сессии при ответвлении и там уже видна; служебное не показывается;
 * вызовы инструментов — короткими метками.
 */

export type Row = {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly text: string
  readonly tools: readonly string[]
}

type Part = { readonly type?: unknown; readonly text?: unknown; readonly name?: unknown }
type Message = {
  readonly id: string
  readonly type?: unknown
  readonly text?: unknown
  readonly content?: unknown
  readonly time?: { readonly created?: number }
}

export function sideRows(messages: readonly Message[], since: number): Row[] {
  return messages.flatMap((message): Row[] => {
    if ((message.time?.created ?? 0) < since) return []
    if (message.type === "user")
      return [{ id: message.id, role: "user", text: typeof message.text === "string" ? message.text : "", tools: [] }]
    if (message.type !== "assistant") return []
    const parts = Array.isArray(message.content) ? (message.content as Part[]) : []
    return [
      {
        id: message.id,
        role: "assistant",
        text: parts
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text as string)
          .join(""),
        tools: parts
          .filter((part) => part.type === "tool" && typeof part.name === "string")
          .map((part) => part.name as string),
      },
    ]
  })
}
