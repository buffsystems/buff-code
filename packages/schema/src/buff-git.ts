export * as BuffGit from "./buff-git.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Git из интерфейса (#454): переключить и создать ветку, закоммитить, отправить, посмотреть
 * историю — не уходя в терминал. Здесь разбор вывода git и правила, общие для ядра, окна и
 * консоли; команды выполняет ядро (`core/src/buff/git.ts`).
 */

export const Change = Schema.Struct({
  file: Schema.String,
  status: Schema.Literals(["added", "modified", "deleted", "renamed", "conflict"]),
  /** Прежнее имя переименованного файла. */
  from: Schema.optional(Schema.String),
})
export type Change = typeof Change.Type

export const State = Schema.Struct({
  /** Текущая ветка; без неё — «оторванная голова» (HEAD не на ветке). */
  branch: Schema.optional(Schema.String),
  /** Ветка на сервере, за которой следит текущая. */
  upstream: Schema.optional(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
  changes: Schema.Array(Change),
})
export type State = typeof State.Type

export const Commit = Schema.Struct({
  hash: Schema.String,
  parents: Schema.Array(Schema.String),
  subject: Schema.String,
  author: Schema.String,
  time: Schema.Number,
  /** Ветки и метки, указывающие на коммит. */
  refs: Schema.Array(Schema.String),
})
export type Commit = typeof Commit.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Failures = { invalid: portable(Schema.Struct({})), failed: portable(Schema.Struct({})) }

export const Rpc = define({
  id: "buff.git",
  methods: {
    state: { input: Nothing, output: portable(State), errors: Failures },
    branches: { input: Nothing, output: portable(Schema.Array(Schema.String)), errors: Failures },
    /** Переключиться на ветку; `create` — создать её от текущего состояния. */
    switch: {
      input: portable(Schema.Struct({ branch: Schema.String, create: Schema.optional(Schema.Boolean) })),
      output: portable(State),
      errors: Failures,
    },
    /** Закоммитить отмеченные файлы целиком — с удалениями и переименованиями. */
    commit: {
      input: portable(Schema.Struct({ message: Schema.String, files: Schema.Array(Schema.String) })),
      output: portable(State),
      errors: Failures,
    },
    push: { input: Nothing, output: portable(State), errors: Failures },
    /**
     * Предложить сообщение коммита по изменениям отмеченных файлов. Запрос к модели идёт от имени
     * сессии: без неё он не привязан к рабочему контексту Buff, и шлюз его не примет.
     */
    message: {
      input: portable(Schema.Struct({ files: Schema.Array(Schema.String), sessionID: Schema.optional(Schema.String) })),
      output: portable(Schema.Struct({ message: Schema.String })),
      errors: Failures,
    },
    /** Страница истории: `skip` коммитов пропустить, `count` показать. */
    log: {
      input: portable(Schema.Struct({ skip: Schema.Number, count: Schema.Number })),
      output: portable(Schema.Array(Commit)),
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

// --- изменения ------------------------------------------------------------------------------

const STATUS: Record<string, Change["status"]> = { "?": "added", A: "added", D: "deleted", R: "renamed", M: "modified" }
const CONFLICT = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"])

/** Вывод `git status --porcelain=v1 -z`: по одной записи на файл; у переименования — оба имени. */
export function changes(output: string): Change[] {
  const records = output.split("\0")
  const found: Change[] = []
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    const file = record.slice(3)
    if (CONFLICT.has(code)) {
      found.push({ file, status: "conflict" })
      continue
    }
    const mark = [code[0], code[1]].find((sign) => sign !== " " && sign !== undefined) ?? "M"
    const status = STATUS[mark] ?? "modified"
    // Прежнее имя переименованного файла идёт следующей записью.
    if (status === "renamed") found.push({ file, status, from: records[++index] })
    else found.push({ file, status })
  }
  return found
}

/** Пути, которые надо отдать git, чтобы изменение вошло в коммит целиком. */
export function paths(selected: readonly Change[]): string[] {
  return selected.flatMap((change) => (change.from ? [change.file, change.from] : [change.file]))
}

/**
 * Что надо добавить в индекс перед коммитом: только то, чего git ещё не знает (новые файлы, новые
 * имена, разрешённые конфликты). Изменённые и удалённые файлы коммит берёт из рабочей копии сам;
 * удаление, уже лежащее в индексе, `git add` не находит и отказывает — его добавлять нельзя.
 */
export function toStage(selected: readonly Change[]): string[] {
  return selected
    .filter((change) => change.status !== "deleted" && change.status !== "modified")
    .map((change) => change.file)
}

const STATUS_LABEL: Record<Change["status"], string> = {
  added: "new",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  conflict: "conflict",
}

/** Что с файлом — словом; строки английские, `t` переводит (модели — по-английски). */
export function changeLabel(change: Change, t: BuffI18n.T = BuffI18n.english): string {
  const status = t(STATUS_LABEL[change.status])
  return change.from ? t("{status} from {from}", { status, from: change.from }) : status
}

// --- впереди и позади -----------------------------------------------------------------------

/** Вывод `git rev-list --left-right --count ветка...upstream`. */
export function aheadBehind(output: string): { ahead: number; behind: number } {
  const [ahead, behind] = output.trim().split(/\s+/).map(Number)
  return { ahead: ahead || 0, behind: behind || 0 }
}

export function syncLabel(
  state: Pick<State, "ahead" | "behind" | "upstream">,
  t: BuffI18n.T = BuffI18n.english,
): string {
  if (!state.upstream) return t("not pushed yet")
  if (!state.ahead && !state.behind) return t("in sync with {upstream}", { upstream: state.upstream })
  return [
    state.ahead ? t("ahead {count}", { count: state.ahead }) : undefined,
    state.behind ? t("behind {count}", { count: state.behind }) : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
}

// --- проверки -------------------------------------------------------------------------------

export function branchProblem(
  name: string,
  existing: readonly string[],
  t: BuffI18n.T = BuffI18n.english,
): string | undefined {
  const branch = name.trim()
  if (!branch) return t("Name the branch.")
  if (branch.startsWith("-")) return t("A branch name does not start with a hyphen.")
  if (/[\s~^:?*[\\]|\.\.|@\{|\/$|^\/|\.lock$/.test(branch))
    return t("A branch name has no spaces, no backslash and none of ~ ^ : ? * [ — for example feature/login.")
  if (existing.includes(branch)) return t("Branch «{branch}» already exists.", { branch })
  return undefined
}

export function commitProblem(
  input: { message: string; files: readonly string[] },
  t: BuffI18n.T = BuffI18n.english,
): string | undefined {
  if (!input.message.trim()) return t("Write a commit message.")
  if (!input.files.length) return t("Tick the files that go into the commit.")
  return undefined
}

const PUSH: readonly (readonly [RegExp, string])[] = [
  [
    /non-fast-forward|fetch first|\[rejected\]/i,
    "The server has commits you do not have. Pull them first (git pull), then push again.",
  ],
  [
    /Authentication failed|could not read Username|Permission denied|403|401/i,
    "The server did not accept the credentials. Check your access to the repository.",
  ],
  [
    /does not appear to be a git repository|No configured push destination|No such remote/i,
    "The repository has no origin remote — there is nowhere to push.",
  ],
  [
    /Could not resolve host|unable to access|Connection refused|timed out/i,
    "The repository server is unreachable. Check the network.",
  ],
]

/** Почему отправка не удалась — словами; незнакомая причина показывается как есть. */
export function pushProblem(output: string, t: BuffI18n.T = BuffI18n.english): string {
  const known = PUSH.find(([pattern]) => pattern.test(output))?.[1]
  return known ? t(known) : output.trim()
}

// --- история --------------------------------------------------------------------------------

/** Поля коммита и коммиты в выводе `git log` разделены служебными знаками — их не бывает в тексте. */
export const LOG_FORMAT = ["%H", "%P", "%s", "%an", "%at", "%D"].join("%x1f") + "%x1e"

export function commits(output: string): Commit[] {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash, parents, subject, author, time, refs] = record.split("\x1f")
      return {
        hash,
        parents: parents ? parents.split(" ") : [],
        subject: subject ?? "",
        author: author ?? "",
        time: Number(time) * 1000,
        refs: refs ? refs.split(", ") : [],
      }
    })
}

export interface GraphRow {
  readonly commit: Commit
  /** В какой колонке точка коммита. */
  readonly column: number
  /** Сколько колонок занято в этой строке. */
  readonly columns: number
  /** Линии к следующей строке: из какой колонки в какую. */
  readonly links: readonly { readonly from: number; readonly to: number }[]
}

/**
 * Граф истории: у каждой линии работы своя колонка, при слиянии линии сходятся. Коммиты идут
 * от новых к старым, как их отдаёт `git log`.
 */
export function graph(history: readonly Commit[]): GraphRow[] {
  let lanes: string[] = []
  return history.map((commit) => {
    if (!lanes.includes(commit.hash)) lanes = [...lanes, commit.hash]
    const column = lanes.indexOf(commit.hash)
    const [first, ...others] = commit.parents
    const raw = [...lanes.flatMap((hash, index) => (index === column ? (first ? [first] : []) : [hash])), ...others]
    const next = [...new Set(raw)]
    const links = lanes
      .flatMap((hash, index) =>
        index === column
          ? commit.parents.map((parent) => ({ from: index, to: next.indexOf(parent) }))
          : [{ from: index, to: next.indexOf(hash) }],
      )
      .toSorted((a, b) => a.from - b.from || a.to - b.to)
    const row = { commit, column, columns: lanes.length, links }
    lanes = next
    return row
  })
}
