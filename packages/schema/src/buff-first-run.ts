export * as BuffFirstRun from "./buff-first-run.js"

import type { BuffPermissionMode } from "./buff-permission-mode.js"

/**
 * Первый запуск Buff Code (#457): что сказать, когда модели нет, сколько живёт код входа, и
 * шаги знакомства. Слова — одни для окна и консоли; знакомство показывает только окно. Строки — английские
 * исходные, переводит экран (#472).
 */

// --- нет модели ------------------------------------------------------------------------------

export interface Readiness {
  readonly signedIn: boolean
  readonly context: boolean
  readonly models: boolean
  /** Есть модель своего провайдера (#562): с ней можно работать и без Buff. */
  readonly own: boolean
}

export interface NoModel {
  readonly text: string
  /** Что исправляет: войти в Buff (или подключить свой провайдер) либо выбрать организацию и проект. */
  readonly action: "sign-in" | "choose-context"
}

/** Почему модели нет и что с этим сделать; модели есть — ничего. */
export function noModel(state: Readiness): NoModel | undefined {
  if (state.own) return undefined
  if (!state.signedIn) return { text: "No model — sign in to Buff or connect your own provider.", action: "sign-in" }
  if (!state.context) return { text: "No model — choose a Buff organization and project.", action: "choose-context" }
  if (!state.models)
    return {
      text: "The organization's models did not load — check the connection to your company's connector or choose the context again.",
      action: "choose-context",
    }
  return undefined
}

/** То же для строки состояния консоли — коротко, с командой. */
export const SIGNED_OUT_SHORT = "no model — sign in to Buff or connect a provider · /connect"

/** Вход в Buff не выполнен, но работа идёт на своём провайдере (#562): не предупреждение. */
export const SIGNED_OUT_OWN = "Buff: not signed in · /connect"

// --- вход ------------------------------------------------------------------------------------

/** Где взять адрес коннектора — под полем адреса в окне входа. */
export const CONNECTOR_HINT =
  "Your organization's administrator gives you the address; it is also on the «Connectors» page of the Buff cabinet."

/** Сколько ещё действует код входа, «м:сс»; истёк — ничего. */
export function codeLeft(expires: number, now: number): string | undefined {
  const seconds = Math.ceil((expires - now) / 1000)
  if (seconds <= 0) return undefined
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export const CODE_EXPIRED = "The sign-in code has expired — get a new one."

// --- знакомство ------------------------------------------------------------------------------

export const STEPS = [
  { title: "What do you do?", note: "This decides how much Buff Code does on its own without asking." },
  { title: "How should Buff Code look?", note: "You can change the theme and text size in settings at any time." },
  { title: "What to turn on?", note: "Both switches are also in the extensions settings." },
] as const

export interface Role {
  readonly value: "develop" | "review" | "documents"
  readonly title: string
  readonly note: string
  /** Режим разрешений новых сессий. */
  readonly mode: BuffPermissionMode.Mode
  /** Начинать ли новые сессии в режиме «План». */
  readonly plan: boolean
}

export const ROLES: readonly Role[] = [
  {
    value: "develop",
    title: "Development",
    note: "I write and edit code — Buff Code edits files on its own and asks before commands.",
    mode: "edit",
    plan: false,
  },
  {
    value: "review",
    title: "Questions and code review",
    note: "I study the code and plan — a plan first, every action confirmed.",
    mode: "ask",
    plan: true,
  },
  {
    value: "documents",
    title: "Documents and knowledge",
    note: "I work with texts and the knowledge base — every action confirmed.",
    mode: "ask",
    plan: false,
  },
]

export const THEMES = [
  { value: "system", title: "As in the system" },
  { value: "light", title: "Light" },
  { value: "dark", title: "Dark" },
] as const

export const MEMORY = {
  title: "Project memory",
  note: "Buff Code reads the project's AGENTS.md and follows the rules written there.",
} as const

export const ASK_FIRST = {
  title: "Check project hooks and commands",
  note: "What comes from the repository does not run until you look at it. Turn off only for your own projects.",
} as const
