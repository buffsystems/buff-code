import { BuffContext } from "./buff-context.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Шаги выбора рабочего контекста (#391) без интерфейса — общие для терминала и десктопа: организация → проект или «без
 * проекта» → пространства. Диалог приходит снаружи (в плагине — ui.dialog.select), так что
 * логику можно проверить без терминала. undefined — человек отменил выбор.
 */

export interface AskOption<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
}
export type Ask = <Value>(dialog: {
  readonly title: string
  readonly options: readonly AskOption<Value>[]
  readonly current?: Value
  /** Что сказать, если выбирать не из чего (#470), — вместо голого «Пусто». */
  readonly empty?: string
}) => Promise<Value | undefined>

type Options = BuffContext.Options
type Choice = BuffContext.Choice

const DONE = Symbol.for("buff.done")

export async function chooseOrg(
  ask: Ask,
  options: Options,
  current: Choice | null,
  t: BuffI18n.T = BuffI18n.english,
): Promise<string | undefined> {
  if (options.orgs.length === 1) return options.orgs[0]
  return ask({
    title: t("Organization"),
    options: options.orgs.map((org) => ({ title: org, value: org })),
    current: current?.org,
    empty: t("You are not in any Buff organization yet. Ask your administrator to add you, then choose again."),
  })
}

export const preselectProject = BuffContext.preselectProject

export async function chooseProject(
  ask: Ask,
  options: Options,
  org: string,
  current: string | null | undefined,
  t: BuffI18n.T = BuffI18n.english,
): Promise<string | null | undefined> {
  const own = options.projects.filter((p) => p.org === org).map((p) => p.name)
  return ask<string | null>({
    title: t("Project in {org}", { org }),
    options: [
      ...own.map((name) => ({ title: name, value: name })),
      { title: t("No project"), value: null, description: t("organization only") },
    ],
    current,
  })
}

/** Отметить и снять пространства по одному, пока человек не выберет «Готово». */
export async function chooseSpaces(
  ask: Ask,
  options: Options,
  org: string,
  current: readonly string[],
  t: BuffI18n.T = BuffI18n.english,
): Promise<string[] | undefined> {
  const own = options.spaces.filter((s) => s.org === org).map((s) => s.name)
  if (!own.length) return []
  const picked = new Set(current.filter((name) => own.includes(name)))
  for (;;) {
    const answer = await ask<string | symbol>({
      title: t("Knowledge spaces of {org}", { org }),
      options: [
        ...own.map((name) => ({ title: `${picked.has(name) ? "[x]" : "[ ]"} ${name}`, value: name })),
        { title: t("Done"), value: DONE },
      ],
    })
    if (answer === undefined) return undefined
    if (answer === DONE) return own.filter((name) => picked.has(name))
    if (typeof answer === "string") picked.has(answer) ? picked.delete(answer) : picked.add(answer)
  }
}

/** Что делать при запуске (#401): всё настраивается в интерфейсе, без отдельных команд. */
export type LaunchStep = "ready" | "sign_in" | "choose" | "unreachable" | "absent"

/** `failure` — отказ rpc options (его `type`), если он был. Отказ без типа — не отказ Buff, а
 *  его отсутствие на этом сервере (чужой сервер, --server): настраивать нечего. */
export function launchStep(
  saved: Choice | null,
  failure: { readonly type?: string; readonly message?: string } | undefined,
): LaunchStep {
  if (failure?.type === "signed_out") return "sign_in"
  if (failure && !failure.type) return "absent"
  if (failure) return "unreachable"
  return saved ? "ready" : "choose"
}

/** Модель своего провайдера (#562): не Buff и не бесплатный уровень OpenCode — тот виден и без
 *  всякого входа, и считай его своим, вход в Buff не предлагался бы никогда. */
export function ownModel(model: { readonly providerID: string; readonly cost: readonly { readonly input: number }[] }): boolean {
  if (model.providerID === "buff") return false
  return model.providerID !== "opencode" || model.cost.some((cost) => cost.input > 0)
}

/**
 * Настраивать ли Buff перед разовой командой (#562): вход в Buff не обязателен. Модель, названная
 * явно, решает сама — не из Buff, и Buff не нужен; без явной модели вход не спрашивается, если
 * подключён свой провайдер. Вход есть, а контекста нет — контекст спрашивается, как раньше.
 */
export function setsUpBuff(
  step: LaunchStep,
  own: { readonly model?: string; readonly connected: boolean },
): boolean {
  if (own.model) return own.model.startsWith("buff/")
  return step !== "sign_in" || !own.connected
}
