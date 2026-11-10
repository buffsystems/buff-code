import { TextAttributes } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffShare } from "@opencode/schema/buff-share"
import { failureMessage } from "@opencode/schema/buff-failure"
import open from "open"
import { Show } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { t } from "./locale"
import { expiryLabels, shareFlow, type ShareUi } from "./share-flow"

/**
 * Публичные ссылки в консоли (#818, эпик #769): /share — ссылка на сессию или выбранные сообщения
 * (заголовок, пароль, срок, инструменты, трансляция); /unshare — снять ссылку этой сессии;
 * /shares — все ссылки машины: открыть, выключить и включить, удалить. Работу ведёт служба
 * Buff Code (rpc `buff.share`, #816), как и для окна.
 */

const shareRpc = (context: Context) => context.client.rpc(BuffShare.Rpc)
type Rpc = ReturnType<typeof shareRpc>

function LinkDialog(props: { link: BuffShare.Link }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  dialog.setSize("large")
  dialog.setCentered(true)
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "o",
        title: t("Open"),
        group: t("Public link"),
        run: () => void open(props.link.link).catch(() => undefined),
      },
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t("The link is ready")}
        </text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text.base}>{props.link.link}</text>
      <Show when={!props.link.hasPass}>
        <text fg={theme.text.feedback.warning.base}>
          {t("Anyone with the link can open it: there is no password.")}
        </text>
      </Show>
      <text fg={theme.text.muted}>{t("o — open in the browser · select the address with the mouse to copy it")}</text>
    </box>
  )
}

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = shareRpc(context)
  const at = () => ({ location: context.location })
  const say = (message: string, variant: "success" | "error" | "info") => context.ui.toast.show({ message, variant })
  const failed = (fallback: string) => (cause: unknown) => say(t(failureMessage(cause, fallback)), "error")
  const session = () => {
    const route = context.ui.router.current()
    return route.type === "session" ? route.sessionID : undefined
  }
  const ui: ShareUi = {
    select: (dialog) => context.ui.dialog.select(dialog).finally(() => context.ui.dialog.clear()),
    prompt: (dialog) => context.ui.dialog.prompt(dialog).finally(() => context.ui.dialog.clear()),
  }

  /** The service must be up: links are made and shown through it. */
  const ready = async (): Promise<Rpc | null> => {
    const status = await rpc.status(undefined, at())
    if (!status.running) {
      await context.ui.dialog.alert({
        title: t("Public link"),
        message: t(
          "The Buff Code service is not running — public links are made through it. Start it: buff service start",
        ),
      })
      context.ui.dialog.clear()
      return null
    }
    if (status.problem) say(status.problem, "error")
    return rpc
  }

  const share = async (preselect?: string[]) => {
    const id = session()
    if (!id) return say(t("Open a session to share it."), "info")
    if (!(await ready())) return
    await context.data.session.message.sync(id).catch(() => undefined)
    const input = await shareFlow(
      ui,
      {
        session: id,
        sessionTitle: context.data.session.get(id)?.title,
        messages: BuffShare.previews(context.data.session.message.list(id)),
        preselect,
        nowMs: Date.now(),
      },
      t,
    )
    if (!input) return
    const link = await rpc
      .create(input, at())
      .catch((cause: unknown) => (failed("The link was not created.")(cause), null))
    if (link) context.ui.dialog.show(() => <LinkDialog link={link} />)
  }

  const unshare = async () => {
    const id = session()
    if (!id) return say(t("Open a session to share it."), "info")
    if (!(await ready())) return
    const links = (await rpc.list(undefined, at())).filter((l) => l.session === id)
    if (!links.length) return say(t("This session has no public links."), "info")
    const picked = await ui.select<string>({
      title: t("Unshare session"),
      options: links.map((l) => ({ title: l.title, value: l.id, description: l.link })),
    })
    if (!picked) return
    await rpc
      .remove({ id: picked }, at())
      .then(() => say(t("The link is deleted."), "success"), failed("The link was not deleted."))
  }

  const manage = async () => {
    if (!(await ready())) return
    const links = await rpc.list(undefined, at())
    if (!links.length) return say(t("No public links yet."), "info")
    const labels = expiryLabels(t)
    const picked = await ui.select<string>({
      title: t("Public links"),
      options: links.map((l) => ({
        title: `${l.enabled ? "●" : "○"} ${l.title}`,
        value: l.id,
        description: [
          l.sessionTitle ?? t("Deleted session"),
          l.hasPass ? t("With password") : t("No password"),
          l.expiresAt === null ? labels.none : t("Expires {when}", { when: new Date(l.expiresAt).toLocaleString() }),
          ...(l.published ? [] : [t("Not yet published")]),
        ].join(" · "),
      })),
    })
    const link = links.find((l) => l.id === picked)
    if (!link) return
    const action = await ui.select<"open" | "toggle" | "pass" | "remove">({
      title: link.title,
      options: [
        { title: t("Open"), value: "open", description: link.link },
        { title: link.enabled ? t("Disable public access") : t("Enable public access"), value: "toggle" },
        { title: link.hasPass ? t("Change the password") : t("Set a password"), value: "pass" },
        {
          title: t("Delete"),
          value: "remove",
          description: t("The page will say the dialog was removed by its owner."),
        },
      ],
    })
    if (action === "open") return void open(link.link).catch(() => say(link.link, "info"))
    if (action === "toggle")
      return rpc
        .update({ id: link.id, enabled: !link.enabled }, at())
        .then(() => say(t("Saved."), "success"), failed("The link was not saved."))
    if (action === "pass") {
      const pass = await ui.prompt({ title: t("New password (leave empty to remove)") })
      if (pass === undefined) return
      return rpc
        .update({ id: link.id, pass: pass || null }, at())
        .then(() => say(t("Saved."), "success"), failed("The link was not saved."))
    }
    if (action === "remove") {
      const yes = await context.ui.dialog.confirm({
        title: t("Delete the link?"),
        message: t("The page will say the dialog was removed by its owner."),
      })
      context.ui.dialog.clear()
      if (yes)
        await rpc
          .remove({ id: link.id }, at())
          .then(() => say(t("The link is deleted."), "success"), failed("The link was not deleted."))
    }
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "session.share",
        title: t("Share session"),
        group: t("Session"),
        palette: true as const,
        slash: { name: "share" },
        run: () => void share().catch(failed("The link was not created.")),
      },
      {
        id: "session.unshare",
        title: t("Unshare session"),
        group: t("Session"),
        palette: true as const,
        slash: { name: "unshare" },
        run: () => void unshare().catch(failed("The link was not deleted.")),
      },
      {
        id: "buff.shares",
        title: t("Buff: public links"),
        group: "Buff",
        palette: true as const,
        slash: { name: "shares" },
        run: () => void manage().catch(failed("Public links did not load.")),
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "buff.share",
  setup(context) {
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
