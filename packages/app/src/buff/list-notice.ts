/**
 * Что написать на месте списка, который нечем заполнить (#458). У апстрима сбой загрузки
 * выдавался за пустоту: «No worktrees yet» при ответе 500. Загрузка, сбой и «ничего нет» —
 * три разных сообщения; сбой показывается и тогда, когда часть списка всё же есть.
 */
export type ListNotice = "loading" | "failed" | "empty"

export function listNotice(input: { pending: boolean; failed: boolean; empty: boolean }): ListNotice | undefined {
  if (input.pending) return "loading"
  if (input.failed) return "failed"
  return input.empty ? "empty" : undefined
}
