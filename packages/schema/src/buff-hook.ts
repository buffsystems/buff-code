export * as BuffHook from "./buff-hook.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Хуки (#446): команда оболочки на событие агента — перед вызовом инструмента (может его
 * запретить), после вызова, перед отправкой запроса. Хранятся в `hooks.json`: у пользователя
 * (все проекты) и в `.opencode` проекта. Хук проекта не выполняется, пока человек его не
 * подтвердил. Здесь правила, общие для ядра, окна и консоли; исполняет и пишет ядро
 * (`core/src/buff/hook.ts`).
 */

export const Event = Schema.Literals(["tool.before", "tool.after", "prompt"])
export type Event = typeof Event.Type

export const Scope = Schema.Literals(["user", "project"])
export type Scope = typeof Scope.Type

const HookFields = {
  id: Schema.String,
  event: Event,
  /** Какие инструменты: имена через запятую, `*` — любое окончание; пусто — любой инструмент. */
  tool: Schema.optional(Schema.String),
  command: Schema.String,
}
export const Hook = Schema.Struct(HookFields)
export type Hook = typeof Hook.Type

export const Entry = Schema.Struct({
  ...HookFields,
  scope: Scope,
  /** Файл, в котором хук записан. */
  path: Schema.String,
  enabled: Schema.Boolean,
  /** Хук проекта: подтверждён ли он человеком; у хуков пользователя поля нет. */
  trusted: Schema.optional(Schema.Boolean),
})
export type Entry = typeof Entry.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))
const Failures = { invalid: Reason, unwritable: Reason }
const Target = Schema.Struct({ scope: Scope, id: Schema.String })

export const Rpc = define({
  id: "buff.hook",
  methods: {
    list: { input: Nothing, output: portable(Schema.Array(Entry)) },
    /** Создать или переписать хук; `previous` — прежние область и имя при переносе. */
    save: {
      input: portable(Schema.Struct({ scope: Scope, ...HookFields, previous: Schema.optional(Target) })),
      output: Nothing,
      errors: Failures,
    },
    remove: { input: portable(Target), output: Nothing, errors: Failures },
    enable: {
      input: portable(Schema.Struct({ ...Target.fields, enabled: Schema.Boolean })),
      output: Nothing,
      errors: Failures,
    },
    /** Что человек проверяет, прежде чем довериться хуку проекта, и отпечаток проверенного. */
    review: {
      input: portable(Schema.Struct({ id: Schema.String })),
      output: portable(Schema.Struct({ text: Schema.String, token: Schema.String })),
      errors: Failures,
    },
    /** Подтвердить просмотренное (`token` из `review`) или отозвать доверие (без `token`). */
    trust: {
      input: portable(Schema.Struct({ id: Schema.String, token: Schema.optional(Schema.String) })),
      output: Nothing,
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

// --- события --------------------------------------------------------------------------------

export const EVENTS: readonly {
  readonly value: Event
  readonly label: string
  readonly hint: string
  readonly tool: boolean
}[] = [
  {
    value: "tool.before",
    label: "Before a tool",
    hint: "The command runs before the call. A non-zero exit code forbids the call, and the model gets its output as the reason.",
    tool: true,
  },
  {
    value: "tool.after",
    label: "After a tool",
    hint: "The command runs after the call — for example, formatting after a file edit.",
    tool: true,
  },
  {
    value: "prompt",
    label: "Before sending a prompt",
    hint: "The command runs when you send a message. Its output is appended to the message.",
    tool: false,
  },
]
const event = (value: Event) => EVENTS.find((item) => item.value === value)!

// --- проверка -------------------------------------------------------------------------------

export function problem(hook: Hook, t: BuffI18n.T = BuffI18n.english): string | undefined {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(hook.id))
    return t("The name is lowercase Latin letters, digits and hyphen, for example format.")
  if (!hook.command.trim()) return t("Enter the command to run.")
  if (hook.tool?.trim() && !event(hook.event).tool)
    return t("The event «{event}» has no tool — leave this field empty.", { event: t(event(hook.event).label) })
  return undefined
}

// --- срабатывание ---------------------------------------------------------------------------

const patterns = (filter: string | undefined) =>
  (filter ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

export function matches(hook: Hook, on: Event, tool?: string): boolean {
  if (hook.event !== on) return false
  const wanted = patterns(hook.tool)
  if (!wanted.length || tool === undefined) return true
  return wanted.some((pattern) => (pattern.endsWith("*") ? tool.startsWith(pattern.slice(0, -1)) : tool === pattern))
}

/** Что команда получает на вход (stdin) — событие в JSON. */
export function payload(input: {
  event: Event
  directory: string
  session: string
  tool?: string
  input?: unknown
  prompt?: string
}): string {
  return JSON.stringify(input)
}

/** Перед инструментом: почему вызов запрещён; `undefined` — разрешён. */
export function verdict(hook: Hook, code: number, output: string): string | undefined {
  if (code === 0) return undefined
  const reason = output.trim()
  // Текст получает модель — по-английски.
  return reason
    ? `Hook «${hook.id}» forbade the call: ${reason}`
    : `Hook «${hook.id}» forbade the call (exit code ${code}).`
}

// --- файл -----------------------------------------------------------------------------------

const decode = Schema.decodeUnknownOption(Hook)
const plain = (hook: Hook): Hook => ({
  id: hook.id,
  event: hook.event,
  ...(hook.tool?.trim() ? { tool: hook.tool.trim() } : {}),
  command: hook.command.trim(),
})

function document(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function fileHooks(text: string): Hook[] {
  const hooks = document(text)?.hooks
  if (!Array.isArray(hooks)) return []
  return hooks.flatMap((item) => {
    const hook = decode(item)
    return hook._tag === "Some" ? [plain(hook.value)] : []
  })
}

/** Файл хуков — не JSON: сообщение — английская строка, переводит тот, кто его показывает. */
export const BROKEN_FILE = "The hooks file is damaged (it is not JSON) — fix it by hand so nothing is lost."

function rewritten(text: string, change: (hooks: Hook[]) => Hook[]): string {
  const current = document(text)
  if (!current) throw new Error(BROKEN_FILE)
  return `${JSON.stringify({ ...current, hooks: change(fileHooks(text)) }, null, 2)}\n`
}

/** Файл с хуком: новый дописывается, существующий заменяется по имени; `previous` — прежнее имя. */
export function fileWith(text: string, hook: Hook, previous?: string): string {
  return rewritten(text, (hooks) => {
    const at = hooks.findIndex((item) => item.id === (previous ?? hook.id))
    const kept = hooks.filter((item, index) => index === at || (item.id !== hook.id && item.id !== previous))
    return at === -1 ? [...kept, plain(hook)] : kept.map((item) => (item === hooks[at] ? plain(hook) : item))
  })
}

export function fileWithout(text: string, id: string): string {
  return rewritten(text, (hooks) => hooks.filter((item) => item.id !== id))
}

// --- слова ----------------------------------------------------------------------------------

/** Когда хук срабатывает — одной строкой. */
export function summary(hook: Hook, t: BuffI18n.T = BuffI18n.english): string {
  const on = event(hook.event)
  return on.tool ? `${t(on.label)} · ${patterns(hook.tool).join(", ") || t("any")}` : t(on.label)
}

/**
 * Что человек проверяет перед доверием. Отпечаток берётся от английского текста (без `t`) — он не
 * зависит от языка; человеку показывается переведённый (#472).
 */
export function reviewText(hook: Hook, t: BuffI18n.T = BuffI18n.english): string {
  return `${t("When: {when}", { when: summary(hook, t) })}\n${t("Command: {command}", { command: hook.command })}`
}

export const UNTRUSTED_NOTE = "Not confirmed: it came from the project and does not run until you check it."

export const ABOUT =
  "A hook is a command Buff Code runs by itself on an event: before or after a tool call, before a prompt is sent. Hooks run on your machine, outside the sandbox; project hooks do not run until you confirm them."
