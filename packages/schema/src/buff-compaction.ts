export * as BuffCompaction from "./buff-compaction.js"

/**
 * Сводка сжатия в ленте окна и консоли (#470). Она написана для модели и описывает только то, что старше
 * сохранённой дословно свежей части, — человеку её показывают по просьбе. Пока сжатие идёт,
 * сводку видно, как её пишут.
 */
export function summaryShown(status: "running" | "completed" | "failed", open: boolean): boolean {
  if (status === "failed") return false
  return status === "running" || open
}
