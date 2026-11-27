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
  /** Выполнен вход личным аккаунтом Buff (#966): его модели — уровни подписки, они считаются своими. */
  readonly account?: boolean
}

export interface NoModel {
  readonly text: string
  /** Что исправляет: войти в Buff (или подключить свой провайдер) либо выбрать организацию и проект. */
  readonly action: "sign-in" | "choose-context" | "connect"
}

/** Почему модели нет и что с этим сделать; модели есть — ничего. */
export function noModel(state: Readiness): NoModel | undefined {
  if (state.own) return undefined
  if (state.account && !state.signedIn)
    return {
      text: "No model — your Buff account has no active subscription. Get one on the site or connect another provider.",
      action: "connect",
    }
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

/** Работа идёт на подписке личного аккаунта Buff (#966): строка состояния называет его. */
export const ACCOUNT_SHORT = "Buff account"

// --- как войти -------------------------------------------------------------------------------

/** Интеграции входа: личный аккаунт (#966) и коннектор компании (#366). */
export const ACCOUNT = "buff-account"
export const COMPANY = "buff"

export interface Way {
  readonly value: "account" | "company" | "other"
  /** Интеграция, в которую ведёт способ; у «другого провайдера» — весь список. */
  readonly integration?: string
  readonly title: string
  readonly note: string
}

/** Первый вход спрашивает, как человек входит: своим аккаунтом, через компанию или со своим провайдером. */
export const SIGN_IN_QUESTION = "How do you sign in?"
export const WAYS: readonly Way[] = [
  { value: "account", integration: ACCOUNT, title: "Buff account", note: "Your subscription — sign in on buff.systems" },
  { value: "company", integration: COMPANY, title: "Company connector", note: "Your organization's models" },
  { value: "other", title: "Another provider", note: "Your own key or your own server" },
]

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

/**
 * Buff (#972): the window's own step — how a chat is shown. The person picks with a press, is
 * told what each choice does and where to change it later. The console has no such step: it is
 * a developer's tool and stays as it is.
 */
export const LAYOUT_STEP = {
  title: "How should a chat look?",
  note: "You can switch at any time: Settings → Appearance → Chat layout.",
} as const

/**
 * Buff (#595, #987): the window's closing step — Buff Code extends itself. Nothing to pick here:
 * it says what «Self-setup» is for and where it is, so the person knows to ask for what is missing.
 */
export const SETUP_STEP = {
  title: "Buff Code sets itself up",
  note: "Open «Self-setup» in the sidebar and say what is missing — the agent does it, checks it and shows you.",
} as const

export const SETUP_POINTS = [
  { title: "Connects to what you use", note: "A tracker, mail, a database, a folder — say its name or give a link." },
  { title: "Draws its answers", note: "Charts are built in. Ask for a diagram or a board of your own and it makes a chat plugin." },
  { title: "Learns your ways", note: "A skill or a rule it keeps for every next chat — proposed first, saved after your yes." },
] as const

export interface Layout {
  readonly value: "simple" | "developer"
  readonly title: string
  readonly note: string
}

export const LAYOUTS: readonly Layout[] = [
  {
    value: "simple",
    title: "Simple",
    note: "The agent's work is one line — «Worked 21 s · 9 steps». Open it to see the steps in plain words. For talking to the agent.",
  },
  {
    value: "developer",
    title: "For a developer",
    note: "Every command, edit and thought of the agent is a block of its own, and you set how much of it to show.",
  },
]

export const LAYOUT_SETTING = {
  title: "Chat layout",
  note: "Simple — the agent's work in one line; for a developer — every command and edit as its own block.",
} as const

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
