export * as BuffKeybinds from "./keybind-rules"

/**
 * Правила горячих клавиш в настройках (#460): что можно назначить и почему нельзя, кто ещё
 * занимает те же клавиши, поиск по нажатому сочетанию. Запись — в форме апстрима
 * («mod+shift+k»), сравнение — по подписям из `signatures`.
 */

const MODIFIERS = new Set(["mod", "ctrl", "alt", "meta"])
const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/

/** Почему это сочетание назначить нельзя (английская строка — экран переводит); можно — ничего. */
export function problem(combo: string): string | undefined {
  const parts = combo.toLowerCase().split("+")
  const key = parts.at(-1) ?? ""
  if (FUNCTION_KEY.test(key)) return undefined
  const modifiers = parts.slice(0, -1)
  if (modifiers.some((part) => MODIFIERS.has(part))) return undefined
  if (modifiers.includes("shift")) return "Shift with a letter is just a capital letter. Add Ctrl or Alt."
  return "A modifier is needed: Ctrl, Alt or Shift with the key — a single key would get in the way of typing."
}

type Used = ReadonlyMap<string, readonly { readonly id: string; readonly title: string }[]>

/** Другие команды с теми же клавишами — для пометки «ещё у: …». */
export function alsoOn(used: Used, signatures: readonly string[], id: string): string[] {
  const titles = signatures.flatMap((signature) =>
    (used.get(signature) ?? []).filter((item) => item.id !== id).map((item) => item.title),
  )
  return [...new Set(titles)]
}

/** Команды, у которых есть ровно это сочетание. */
export function withCombo(
  ids: readonly string[],
  signatures: (id: string) => readonly string[],
  combo: readonly string[],
) {
  return ids.filter((id) => signatures(id).some((signature) => combo.includes(signature)))
}
