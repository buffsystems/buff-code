export * as BuffPermissionMode from "./buff-permission-mode.js"

import { BuffI18n } from "./buff-i18n.js"

/**
 * Режим разрешений и запрос разрешения (#450). Режим — сколько агенту доверяют в этой сессии:
 * спрашивать перед правками и командами, править самому, не спрашивать внутри проекта. Режим —
 * это правила сессии; ядро их уже умеет, нужны только названия и перевод «режим ↔ правила».
 * Здесь же слова запроса разрешения, общие для окна и консоли. Подписи — английские исходные
 * строки; переводит экран (#472).
 */

export type Mode = "ask" | "edit" | "full"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

// #470: имя режима одно — в меню, в чипе под полем ввода и в автоматизациях; объясняет подсказка.
export const MODES: readonly { readonly value: Mode; readonly label: string; readonly hint: string }[] = [
  {
    value: "ask",
    label: "Ask",
    hint: "A question before every file edit and every command. The agent may read and search on its own.",
  },
  {
    value: "edit",
    label: "Edit on its own",
    hint: "The agent edits project files on its own; shell commands get a question first.",
  },
  {
    value: "full",
    label: "Full access",
    hint: "Edits and commands in the project — no questions. Outside the project and for .env files it still asks.",
  },
]

const SHELL: Rule = { action: "shell", resource: "*", effect: "ask" }
const EDIT: Rule = { action: "edit", resource: "*", effect: "ask" }

/**
 * Правила сессии для режима. В режиме плана правило о правках не добавляется: правила сессии
 * сильнее правил агента, и «спрашивать» сняло бы запрет на правки, который держит агент плана.
 */
export function rules(mode: Mode, plan: boolean): Rule[] {
  if (mode === "full") return []
  return mode === "ask" && !plan ? [EDIT, SHELL] : [SHELL]
}

const same = (a: readonly Rule[], b: readonly Rule[]) =>
  a.length === b.length &&
  a.every(
    (rule, index) =>
      rule.action === b[index].action && rule.resource === b[index].resource && rule.effect === b[index].effect,
  )

/** Режим по правилам сессии; `undefined` — правила писал кто-то другой. */
export function modeOf(current: readonly Rule[] | undefined, plan: boolean): Mode | undefined {
  return MODES.map((mode) => mode.value).find((mode) => same(rules(mode, plan), current ?? []))
}

const SHORT: Record<Mode, string> = { ask: "Ask", edit: "Edit on its own", full: "Full access" }

export function short(mode: Mode | undefined, t: BuffI18n.T = BuffI18n.english): string {
  return t(mode ? SHORT[mode] : "Custom rules")
}

// --- запрос разрешения ----------------------------------------------------------------------

/** Что запомнит «Всегда» — словами; `undefined` — запоминать нечего. */
export function alwaysNote(
  request: {
    readonly action: string
    readonly save?: readonly string[]
  },
  t: BuffI18n.T = BuffI18n.english,
): string | undefined {
  const save = request.save ?? []
  if (!save.length) return undefined
  // #470: подсказка — простой текст, обратные кавычки в ней видны как есть.
  const list = save.join(", ")
  const any = save.every((item) => item === "*")
  const what =
    request.action === "shell"
      ? t("commands {list}", { list })
      : request.action === "edit"
        ? any
          ? t("edits to any files")
          : t("edits to {list}", { list })
        : request.action === "external_directory" || request.action === "read"
          ? t("access to {list}", { list })
          : t("tool {tool} — {calls}", { tool: request.action, calls: any ? t("any calls") : list })
  return t("«Always» remembers for this project: {what}.", { what })
}

/** Запрос пришёл от субагента: его сессия — дочерняя. */
export function fromSubagent(
  request: { readonly sessionID: string },
  sessions: readonly { readonly id: string; readonly parentID?: string }[],
): boolean {
  return !!sessions.find((session) => session.id === request.sessionID)?.parentID
}

export const REJECT_PLACEHOLDER = "What to do instead — goes to the model, the turn continues"
export const SUBAGENT = "from a subagent"
