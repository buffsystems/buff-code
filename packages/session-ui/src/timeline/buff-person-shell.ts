/**
 * Команда, которую человек запустил сам («!»), — в ленте с выводом (#470). Группа из одних таких
 * команд открыта сразу; если в ней есть работа агента, она свёрнута, как у апстрима.
 */
export function personShellOnly(parts: readonly { type: string }[]): boolean {
  return parts.length > 0 && parts.every((part) => part.type === "shell")
}
