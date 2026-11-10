// Публичная ссылка в консоли (#818): шаги диалогов без интерфейса — что показать, по порядку —
// чтобы сценарий проверялся без терминала. Диалоги приходят снаружи (ui.dialog.select / prompt);
// undefined — человек отменил.
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffShare } from "@opencode/schema/buff-share"

export interface AskOption<Value> {
  readonly title: string
  readonly value: Value
  readonly description?: string
}

export interface ShareUi {
  select<Value>(dialog: {
    readonly title: string
    readonly options: readonly AskOption<Value>[]
    readonly current?: Value
  }): Promise<Value | undefined>
  prompt(dialog: {
    readonly title: string
    readonly description?: string
    readonly value?: string
  }): Promise<string | undefined>
}

const DONE = Symbol.for("buff.share.done")

/** Сроки действия, как их читает человек. */
export function expiryLabels(t: BuffI18n.T): Record<BuffShare.ExpiryPreset, string> {
  return { none: t("Never"), "1h": t("In an hour"), "1d": t("In a day"), "7d": t("In 7 days"), "30d": t("In 30 days") }
}

/**
 * Весь диалог или выбранные сообщения → заголовок → пароль → срок → инструменты → трансляция.
 * `preselect` — сообщение, с которого начали (действие у сообщения): выбор открывается с ним.
 */
export async function shareFlow(
  ui: ShareUi,
  input: {
    session: string
    sessionTitle: string | undefined
    messages: readonly BuffShare.MessagePreview[]
    preselect?: readonly string[]
    nowMs: number
  },
  t: BuffI18n.T = BuffI18n.english,
): Promise<BuffShare.CreateInput | undefined> {
  const scope = await ui.select<"all" | "some">({
    title: t("Public link"),
    options: [
      { title: t("Whole dialog"), value: "all" },
      { title: t("Selected messages"), value: "some", description: t("pick the messages to show") },
    ],
    current: input.preselect?.length ? "some" : "all",
  })
  if (scope === undefined) return undefined
  let messages: string[] | undefined
  if (scope === "some") {
    messages = await pickMessages(ui, input.messages, input.preselect ?? [], t)
    if (!messages) return undefined
  }
  const title = (
    await ui.prompt({ title: t("Link title"), value: BuffShare.defaultTitle(input.sessionTitle, t("Untitled")) })
  )?.trim()
  if (!title) return undefined
  const pass = await ui.prompt({
    title: t("Password (optional)"),
    description: t("Without a password anyone with the link opens the page."),
  })
  if (pass === undefined) return undefined
  const labels = expiryLabels(t)
  const expiry = await ui.select<BuffShare.ExpiryPreset>({
    title: t("Expires"),
    options: BuffShare.EXPIRY_PRESETS.map((p) => ({
      title: labels[p.id as BuffShare.ExpiryPreset],
      value: p.id as BuffShare.ExpiryPreset,
    })),
    current: "none",
  })
  if (expiry === undefined) return undefined
  const tools = await yesNo(ui, t("Show AI tool calls and their results"), false, t)
  if (tools === undefined) return undefined
  const live = await yesNo(ui, t("Follow the session live"), false, t)
  if (live === undefined) return undefined
  return {
    session: input.session,
    ...(messages ? { messages } : {}),
    title,
    ...(pass ? { pass } : {}),
    expiresAt: BuffShare.expiresAtFor(expiry, input.nowMs),
    tools,
    live,
  }
}

/** Отмечать и снимать сообщения, пока не «Готово»; пустой выбор — вопрос повторяется. */
async function pickMessages(
  ui: ShareUi,
  previews: readonly BuffShare.MessagePreview[],
  preselect: readonly string[],
  t: BuffI18n.T,
): Promise<string[] | undefined> {
  const picked = new Set(preselect.filter((id) => previews.some((m) => m.id === id)))
  for (;;) {
    const answer = await ui.select<string | typeof DONE>({
      title: t("Selected messages"),
      options: [
        ...previews.map((m) => ({
          title: `${picked.has(m.id) ? "☑" : "☐"} ${m.role === "user" ? t("You") : t("Assistant")}: ${m.text}`,
          value: m.id,
        })),
        { title: t("Done"), value: DONE, description: t("{count} messages", { count: picked.size }) },
      ],
    })
    if (answer === undefined) return undefined
    if (answer === DONE) {
      if (picked.size) return previews.filter((m) => picked.has(m.id)).map((m) => m.id)
      continue
    }
    if (picked.has(answer)) picked.delete(answer)
    else picked.add(answer)
  }
}

async function yesNo(ui: ShareUi, title: string, current: boolean, t: BuffI18n.T): Promise<boolean | undefined> {
  return ui.select<boolean>({
    title,
    options: [
      { title: t("No"), value: false },
      { title: t("Yes"), value: true },
    ],
    current,
  })
}
