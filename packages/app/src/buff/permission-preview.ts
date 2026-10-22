/**
 * Предпросмотр правки в запросе разрешения (#470): инструменты правки кладут в запрос дифф файлов
 * (`metadata.files`); окно запроса показывает его, чтобы в режиме «Спрашивать» решение принималось
 * по самой правке, а не по имени файла.
 */

export type PermissionDiff =
  | { readonly file: string; readonly patch: string }
  | { readonly file: string; readonly before: string; readonly after: string }

export function permissionDiffs(metadata: Readonly<Record<string, unknown>> | undefined): PermissionDiff[] {
  const files = metadata?.files
  if (!Array.isArray(files)) return []
  return files.flatMap((item): PermissionDiff[] => {
    if (!item || typeof item !== "object") return []
    const { file, patch, before, after } = item as Record<string, unknown>
    if (typeof file !== "string") return []
    if (typeof patch === "string") return [{ file, patch }]
    if (typeof before === "string" && typeof after === "string") return [{ file, before, after }]
    return []
  })
}
