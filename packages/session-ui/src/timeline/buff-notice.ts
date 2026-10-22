/**
 * Служебные отметки в ленте (#470). Свёрнутая группа из одних отметок называется по ним самим
 * («Цель»), а итог, переданный в `metadata.summary`, виден рядом с названием отметки.
 */

export function noticeGroupTitle(titles: readonly (string | undefined)[]): string | undefined {
  const distinct = [...new Set(titles.filter((title): title is string => !!title))]
  return distinct.length ? distinct.join(", ") : undefined
}

export function noticeSummary(metadata: Record<string, unknown> | undefined): string | undefined {
  const summary = metadata?.summary
  return typeof summary === "string" && summary ? summary : undefined
}
