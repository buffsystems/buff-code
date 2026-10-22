export * as BuffWorkflowPanels from "./buff-workflow-panels.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Панели прогона сценария (#448): что сценарий объявил через artifact.table/metrics/chart/board
 * и наполнил через report(item, "id"). Здесь — только вычисление по описанию и строкам; рисуют
 * окно и консоль каждый по-своему. Значения берутся по пути через точки ("timing.after").
 */

export interface Field {
  readonly field: string
  readonly label?: string
  readonly unit?: string
}
export interface TableSpec {
  readonly columns: readonly Field[]
  readonly key?: string
}
export interface MetricsSpec {
  readonly metrics: readonly Field[]
}
export interface ChartSpec {
  readonly type?: "line" | "bar"
  readonly x: Field
  readonly y: Field | readonly Field[]
}
export interface BoardSpec {
  readonly key: string
  readonly status: string
  readonly columns: readonly string[]
  readonly cardTitle?: string
  readonly detail?: readonly Field[]
}

export function field(item: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined,
      item,
    )
}

export function text(value: unknown, unit?: string, t: BuffI18n.T = BuffI18n.english): string {
  if (value === undefined || value === null) return "—"
  const shown =
    typeof value === "boolean"
      ? value
        ? t("yes")
        : t("no")
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value)
  return unit ? `${shown} ${unit}` : shown
}

const label = (item: Field) => item.label ?? item.field

/** Строки, у которых есть ключ: следующая с тем же ключом заменяет прежнюю на её месте. */
function keyed(values: readonly unknown[], key: string | undefined): unknown[] {
  if (!key) return [...values]
  const rows = new Map<string, unknown>()
  for (const value of values) rows.set(text(field(value, key)), value)
  return [...rows.values()]
}

export function of(id: string, items: readonly { readonly value: unknown; readonly artifact?: string }[]): unknown[] {
  return items.filter((item) => item.artifact === id).map((item) => item.value)
}

type Items = readonly { readonly value: unknown; readonly artifact?: string }[]
const values = (items: Items) => items.map((item) => item.value)

export function table(spec: TableSpec, items: Items, t: BuffI18n.T = BuffI18n.english) {
  return {
    columns: spec.columns.map(label),
    rows: keyed(values(items), spec.key).map((row) =>
      spec.columns.map((column) => text(field(row, column.field), column.unit, t)),
    ),
  }
}

export function metrics(spec: MetricsSpec, items: Items, t: BuffI18n.T = BuffI18n.english) {
  const list = values(items)
  return spec.metrics.map((metric) => {
    const newest = list.map((item) => field(item, metric.field)).findLast((value) => value !== undefined)
    return { label: label(metric), value: text(newest, metric.unit, t) }
  })
}

export function chart(spec: ChartSpec, items: Items, t: BuffI18n.T = BuffI18n.english) {
  const list = values(items)
  const ys: readonly Field[] = Array.isArray(spec.y) ? spec.y : [spec.y as Field]
  return {
    type: spec.type ?? "line",
    x: label(spec.x),
    series: ys.map((y) => ({
      label: label(y),
      points: list.flatMap((item) => {
        const value = Number(field(item, y.field))
        return field(item, y.field) === undefined || !Number.isFinite(value)
          ? []
          : [{ x: text(field(item, spec.x.field), undefined, t), y: value }]
      }),
    })),
  }
}

export function board(spec: BoardSpec, items: Items, t: BuffI18n.T = BuffI18n.english) {
  const cards = keyed(values(items), spec.key).map((item) => ({
    key: text(field(item, spec.key)),
    status: text(field(item, spec.status), undefined, t),
    title: text(field(item, spec.cardTitle ?? spec.key), undefined, t),
    detail: (spec.detail ?? []).map((detail) => `${label(detail)}: ${text(field(item, detail.field), detail.unit, t)}`),
  }))
  const extra = [...new Set(cards.map((card) => card.status))].filter((status) => !spec.columns.includes(status))
  return [...spec.columns, ...extra].map((name) => ({
    name,
    cards: cards.filter((card) => card.status === name).map(({ key, title, detail }) => ({ key, title, detail })),
  }))
}
