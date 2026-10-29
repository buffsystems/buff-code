export * as BuffSessionMarks from "./buff-session-marks.js"

import { Schema } from "effect"
import { define } from "./rpc.js"

/**
 * Отметки сессий (#452): закрепление, архив и группы. Отметки — выбор человека, а не свойство
 * сессии: они хранятся у пользователя и одни на окно и консоль. Здесь правила, общие для обоих:
 * как меняются отметки, как из них складывается список и каким словом названо состояние сессии.
 * Хранит ядро (`core/src/buff/session-marks.ts`).
 */

export const COLORS = ["blue", "green", "orange", "red", "purple", "gray"] as const
export const Color = Schema.Literals(COLORS)
export type Color = typeof Color.Type

export const Group = Schema.Struct({ id: Schema.String, name: Schema.String, color: Color })
export type Group = typeof Group.Type

export const State = Schema.Struct({
  pinned: Schema.Array(Schema.String),
  /** Архив — вместо удаления: сессия уходит из списков и возвращается одним действием. */
  archived: Schema.Array(Schema.String),
  groups: Schema.Array(Group),
  /** В какой группе сессия. */
  membership: Schema.Record(Schema.String, Schema.String),
  /**
   * Побочные диалоги (#470, как в ZCode): живут во вкладке своей основной сессии, в списках их
   * нет. Это не выбор человека — ядро добавляет их при выдаче отметок, само не хранит.
   */
  sides: Schema.optional(Schema.Array(Schema.String)),
})
export type State = typeof State.Type

export const EMPTY: State = { pinned: [], archived: [], groups: [], membership: {} }

export const Change = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pin"), sessionID: Schema.String, on: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("archive"), sessionID: Schema.String, on: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("group.save"), group: Group }),
  Schema.Struct({ type: Schema.Literal("group.remove"), groupID: Schema.String }),
  /** Без `groupID` — убрать сессию из группы. */
  Schema.Struct({
    type: Schema.Literal("group.assign"),
    sessionID: Schema.String,
    groupID: Schema.optional(Schema.String),
  }),
])
export type Change = typeof Change.Type

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.session-marks",
  methods: {
    get: { input: portable(Schema.Undefined), output: portable(State) },
    change: { input: portable(Change), output: portable(State), errors: { invalid: portable(Schema.Struct({})) } },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

// --- изменение ------------------------------------------------------------------------------

const without = (list: readonly string[], id: string) => list.filter((item) => item !== id)
const withID = (list: readonly string[], id: string) => (list.includes(id) ? [...list] : [...list, id])

export function problem(change: Change, state: State): string | undefined {
  if (change.type === "group.save" && !change.group.name.trim()) return "Name the group."
  if (change.type === "group.assign" && change.groupID && !state.groups.some((group) => group.id === change.groupID))
    return "No such group."
  return undefined
}

export function apply(state: State, change: Change): State {
  switch (change.type) {
    case "pin":
      return {
        ...state,
        pinned: change.on ? withID(state.pinned, change.sessionID) : without(state.pinned, change.sessionID),
      }
    case "archive":
      return change.on
        ? {
            ...state,
            archived: withID(state.archived, change.sessionID),
            pinned: without(state.pinned, change.sessionID),
          }
        : { ...state, archived: without(state.archived, change.sessionID) }
    case "group.save": {
      const group = { ...change.group, name: change.group.name.trim() }
      const known = state.groups.some((item) => item.id === group.id)
      return {
        ...state,
        groups: known ? state.groups.map((item) => (item.id === group.id ? group : item)) : [...state.groups, group],
      }
    }
    case "group.remove":
      return {
        ...state,
        groups: state.groups.filter((group) => group.id !== change.groupID),
        membership: Object.fromEntries(
          Object.entries(state.membership).filter(([, group]) => group !== change.groupID),
        ),
      }
    case "group.assign": {
      const rest = Object.fromEntries(Object.entries(state.membership).filter(([id]) => id !== change.sessionID))
      return { ...state, membership: change.groupID ? { ...rest, [change.sessionID]: change.groupID } : rest }
    }
  }
}

// --- список ---------------------------------------------------------------------------------

export const isSide = (marks: State, id: string): boolean => (marks.sides ?? []).includes(id)

/** Кого не показывать в обычном списке: архивные и побочные диалоги. */
export const hidden = (marks: State): Set<string> => new Set([...marks.archived, ...(marks.sides ?? [])])

interface Listed {
  readonly id: string
  readonly title?: string
  /** Когда сессия менялась, мс. */
  readonly updated: number
}

export interface Section<Item> {
  readonly key: string
  readonly title: string
  readonly kind: "pinned" | "group" | "time" | "project"
  readonly group?: Group
  readonly items: readonly Item[]
}

const DAY = 24 * 60 * 60 * 1000
const startOfDay = (time: number) => {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
const newestFirst = <Item extends Listed>(items: readonly Item[]) => items.toSorted((a, b) => b.updated - a.updated)

/**
 * Список сессий по разделам: закреплённые (в порядке закрепления), группы, затем по времени —
 * или по проектам, когда окно даёт `projectOf` (#709): свежий проект выше, заголовок — имя папки.
 * Архивные и побочные диалоги не показываются. Группа видна и пустой — в неё можно класть. При поиске пустые
 * разделы пропадают.
 */
export function sections<Item extends Listed>(
  sessions: readonly Item[],
  marks: State,
  now: number,
  query = "",
  projectOf?: (item: Item) => string,
): Section<Item>[] {
  const needle = query.trim().toLowerCase()
  const out = hidden(marks)
  const shown = sessions.filter(
    (item) => !out.has(item.id) && (!needle || (item.title ?? "").toLowerCase().includes(needle)),
  )
  const byID = new Map(shown.map((item) => [item.id, item]))
  const pinned = marks.pinned.flatMap((id) => (byID.has(id) ? [byID.get(id)!] : []))
  const taken = new Set(pinned.map((item) => item.id))
  const groups = marks.groups.map((group): Section<Item> => {
    const items = newestFirst(shown.filter((item) => !taken.has(item.id) && marks.membership[item.id] === group.id))
    for (const item of items) taken.add(item.id)
    return { key: `group:${group.id}`, title: group.name, kind: "group", group, items }
  })
  const rest = newestFirst(shown.filter((item) => !taken.has(item.id)))
  const head = [
    ...(pinned.length ? [{ key: "pinned", title: "Pinned", kind: "pinned" as const, items: pinned }] : []),
    ...groups.filter((section) => !needle || section.items.length),
  ]
  if (projectOf) return [...head, ...byProject(rest, projectOf)]
  const today = startOfDay(now)
  const time: Section<Item>[] = [
    { key: "today", title: "Today", kind: "time", items: rest.filter((item) => item.updated >= today) },
    {
      key: "yesterday",
      title: "Yesterday",
      kind: "time",
      items: rest.filter((item) => item.updated < today && item.updated >= today - DAY),
    },
    { key: "older", title: "Earlier", kind: "time", items: rest.filter((item) => item.updated < today - DAY) },
  ]
  return [...head, ...time.filter((section) => section.items.length)]
}

/** Сессии по проектам; `items` уже свежие первыми, поэтому и проекты встают по свежести. */
function byProject<Item extends Listed>(items: readonly Item[], projectOf: (item: Item) => string): Section<Item>[] {
  const out = new Map<string, Item[]>()
  for (const item of items) {
    const project = projectOf(item)
    out.set(project, [...(out.get(project) ?? []), item])
  }
  return [...out].map(([project, list]) => ({
    key: `project:${project}`,
    title: project.split(/[\\/]/).filter(Boolean).pop() ?? project,
    kind: "project" as const,
    items: list,
  }))
}

/** Архив — отдельным списком, свежие первыми. */
export function archive<Item extends Listed>(sessions: readonly Item[], marks: State): Item[] {
  const archived = new Set(marks.archived)
  return newestFirst(sessions.filter((item) => archived.has(item.id) && !isSide(marks, item.id)))
}

// --- состояние ------------------------------------------------------------------------------

export type StatusKind = "permission" | "question" | "running" | "failed" | "unread"

/** Подписи — английские исходные строки; переводит их экран (#472). */
const STATUS: Record<StatusKind, string> = {
  permission: "Waiting for permission",
  question: "Waiting for an answer",
  running: "Running",
  failed: "Error",
  unread: "Unread",
}

/** Состояние сессии одним словом: сначала то, что требует человека. */
export function status(input: {
  permission?: boolean
  question?: boolean
  running?: boolean
  failed?: boolean
  unread?: boolean
}): { kind: StatusKind; label: string } | undefined {
  const kind = (["permission", "question", "running", "failed", "unread"] as const).find((key) => input[key])
  return kind ? { kind, label: STATUS[kind] } : undefined
}
