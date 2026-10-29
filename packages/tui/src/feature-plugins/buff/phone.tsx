import { TextAttributes } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { BuffMobile } from "@opencode/schema/buff-mobile"
import { failureMessage } from "@opencode/schema/buff-failure"
import open from "open"
import { createSignal, onCleanup, Show } from "solid-js"
import { renderUnicodeCompact } from "uqr"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { t } from "./locale"
import { pairConfirm } from "./phone-note"

/**
 * Телефон в консоли (#640): /phone — подключить телефон по QR или по ссылке с кодом, сверить код
 * на обоих экранах и подтвердить здесь; список телефонов — переименовать, отключить. Работу ведёт
 * служба Buff Code (rpc `buff.mobile`, #639), как и для окна.
 */

const QR = "qr"
const CODE = "code"
const APP = "app:"
const POLL_MS = 1500
const now = () => Math.floor(Date.now() / 1000)
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

const mobileRpc = (context: Context) => context.client.rpc(BuffMobile.Rpc)
type Rpc = ReturnType<typeof mobileRpc>

function PairDialog(props: { rpc: Rpc; kind: "qr" | "code"; at: () => object; onPaired: () => void }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const [offer, setOffer] = createSignal<BuffMobile.Offer>()
  const [problem, setProblem] = createSignal<string>()
  const [tick, setTick] = createSignal(now())
  dialog.setSize("large")
  dialog.setCentered(true)

  const start = () =>
    props.rpc.offer({ kind: props.kind }, props.at()).then(
      (next) => (setProblem(undefined), setOffer(next)),
      (cause: unknown) => setProblem(t(failureMessage(cause, "The pairing did not start."))),
    )
  void start()
  const timer = setInterval(() => {
    setTick(now())
    const current = offer()
    if (!current || !BuffMobile.isLive(current)) return
    props.rpc.view({ offerId: current.offerId }, props.at()).then(
      (next) => {
        setOffer(next)
        if (next.state === "paired") props.onPaired()
      },
      () => undefined,
    )
  }, POLL_MS)
  // Closed before a phone confirmed: the offer is withdrawn on the service.
  onCleanup(() => {
    clearInterval(timer)
    const current = offer()
    if (current && BuffMobile.isLive(current))
      void props.rpc.cancel({ offerId: current.offerId }, props.at()).catch(() => undefined)
  })

  const left = () => Math.max(0, (offer()?.expiresAt ?? 0) - tick())
  const comparing = () => offer()?.state === "sas" || offer()?.state === "confirm"
  const confirm = () => {
    const o = offer()
    return pairConfirm(o?.kind === "qr" ? "qr" : "code", o?.phone ?? "", o?.sas ?? "")
  }
  const expired = () => offer()?.state === "failed" || (!!offer() && BuffMobile.isLive(offer()) && left() === 0)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: t("It matches"),
        group: t("Phone"),
        run: () => {
          const current = offer()
          if (current && comparing())
            return void props.rpc.confirm({ offerId: current.offerId }, props.at()).then(
              (next) => (setOffer(next), next.state === "paired" && props.onPaired()),
              (cause: unknown) => setProblem(t(failureMessage(cause, "The phone was not confirmed."))),
            )
          if (expired() || problem()) void start()
        },
      },
      {
        bind: "n",
        title: t("Not my phone"),
        group: t("Phone"),
        run: () => {
          const current = offer()
          if (!current || !comparing()) return
          void props.rpc.cancel({ offerId: current.offerId }, props.at()).finally(() => void start())
        },
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          {t("Pair a phone")}
        </text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={problem()}>{(text) => <text fg={theme.text.feedback.error.base}>{text()}</text>}</Show>
      <Show when={offer()} fallback={<text fg={theme.text.muted}>{t("Preparing the pairing")}</text>}>
        {(current) => (
          <Show
            when={current().state !== "paired"}
            fallback={
              <text fg={theme.text.base}>
                {t("The phone «{name}» is connected. It reconnects by itself.", { name: current().phone ?? "" })}
              </text>
            }
          >
            <Show
              when={comparing()}
              fallback={
                <Show
                  when={!expired()}
                  fallback={<text fg={theme.text.muted}>{t("The offer ran out. Enter — a new one.")}</text>}
                >
                  <Show
                    when={current().kind === "qr"}
                    fallback={
                      <box gap={1}>
                        <text fg={theme.text.muted}>{t("Open the link on the phone and type the code.")}</text>
                        <text fg={theme.text.base}>{current().link}</text>
                        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                          {(current().code ?? "").replace("-", " ")}
                        </text>
                      </box>
                    }
                  >
                    <text fg={theme.text.muted}>{t("Open Buff on the phone and scan the code.")}</text>
                    <text fg={theme.text.base}>{renderUnicodeCompact(current().link, { border: 1 })}</text>
                  </Show>
                  <text fg={theme.text.muted}>{t("Valid for {time}", { time: clock(left()) })}</text>
                </Show>
              }
            >
              <box gap={1}>
                <text fg={theme.text.base}>{confirm().prompt}</text>
                <Show when={confirm().code}>
                  <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                    {confirm().code}
                  </text>
                </Show>
                <text fg={theme.text.muted}>{confirm().keys}</text>
              </box>
            </Show>
          </Show>
        )}
      </Show>
    </box>
  )
}

/** Над полем ввода сессии, начатой с телефона: с какого, и что продолжать можно и здесь. */
function PhoneBanner(props: { context: Context; sessionID: string }) {
  const origin = () => BuffMobile.phoneOrigin(props.context.data.session.get(props.sessionID)?.metadata)
  return (
    <Show when={origin()}>
      {(phone) => (
        <box paddingLeft={2} paddingRight={2}>
          <text fg={props.context.theme.text.muted}>
            {t("Started on the phone «{device}» — continue here or on the phone, it is one session.", {
              device: phone().device ?? "",
            })}
          </text>
        </box>
      )}
    </Show>
  )
}

function Commands(props: { context: Context }) {
  const { context } = props
  const rpc = mobileRpc(context)
  const at = () => ({ location: context.location })
  const say = (message: string, variant: "success" | "error" | "info") => context.ui.toast.show({ message, variant })
  const failed = (fallback: string) => (cause: unknown) => say(t(failureMessage(cause, fallback)), "error")

  const act = async (phone: BuffMobile.Phone) => {
    const picked = await context.ui.dialog.select({
      title: phone.display,
      options: [
        { title: t("Rename"), value: "rename" },
        { title: t("Disconnect"), value: "revoke", description: t("The phone loses access to this machine.") },
      ],
    })
    context.ui.dialog.clear()
    if (picked === "rename") {
      const display = (await context.ui.dialog.prompt({ title: t("Rename the phone"), value: phone.display }))?.trim()
      context.ui.dialog.clear()
      if (display) await rpc.rename({ device: phone.device, display }, at()).catch(failed("The phone was not renamed."))
    }
    if (picked === "revoke") {
      const yes = await context.ui.dialog.confirm({
        title: t("Disconnect the phone?"),
        message: t("«{name}» loses access to this machine; pairing it again takes a new code.", {
          name: phone.display,
        }),
      })
      context.ui.dialog.clear()
      if (yes)
        await rpc
          .revoke({ device: phone.device }, at())
          .then(() => say(t("The phone is disconnected."), "success"), failed("The phone was not disconnected."))
    }
  }

  const list = async () => {
    const status = await rpc.status(undefined, at())
    if (!status.running)
      return context.ui.dialog.alert({
        title: t("Phone"),
        message: t(
          "The Buff Code service is not running: the phone reaches this machine through it. Start it: buff service start",
        ),
      })
    // Signed into an install that forbids phones: nothing to pair, the pairs are already cut.
    if (status.home?.forbidden)
      return context.ui.dialog.alert({
        title: t("Phone"),
        message: t(
          "Pairing phones is forbidden by the policy of «{name}»: Buff Code is signed in there, and its rules apply to this machine.",
          {
            name: status.home.name,
          },
        ),
      })
    // The machine itself does not reach the gateway: no phone reaches it either — said at once.
    if (status.problem) say(status.problem, "error")
    const phones = await rpc.phones(undefined, at())
    const choice = context.ui.dialog.select({
      title: t("Phone — Buff on the phone, through {gateway}", { gateway: status.gateway }),
      options: [
        ...(status.home
          ? [
              {
                title: t("Signed in to «{name}»: its phone policy applies", { name: status.home.name }),
                value: "home",
                disabled: true,
              },
            ]
          : []),
        { title: `＋ ${t("Pair by QR code")}`, value: QR },
        { title: `＋ ${t("Pair by link and code")}`, value: CODE },
        ...phones.map((phone) => ({
          title: phone.display,
          value: phone.device,
          description: phone.online ? t("on the line") : t("not on the line"),
          category: t("Paired phones"),
        })),
        // Where to get the app (#704): the gateway's site pages, opened in the browser.
        ...BuffMobile.appLinks(status.gateway).map((link) => ({
          title: link.store === "apk" ? t("Download the APK for Android") : link.name,
          value: APP + link.url,
          description: link.url,
          category: t("The Buff app"),
        })),
      ],
    })
    // The title names the gateway: a wider dialog keeps it on one line.
    context.ui.dialog.set({ size: "large" })
    const picked = await choice
    context.ui.dialog.clear()
    if (picked?.startsWith(APP))
      return void open(picked.slice(APP.length)).catch(() => say(picked.slice(APP.length), "info"))
    if (picked === QR || picked === CODE)
      return context.ui.dialog.show(() => (
        <PairDialog rpc={rpc} kind={picked} at={at} onPaired={() => say(t("Phone connected."), "success")} />
      ))
    const phone = phones.find((item) => item.device === picked)
    if (phone) return act(phone)
  }

  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "buff.phone",
        title: t("Buff: phone"),
        group: "Buff",
        palette: true as const,
        slash: { name: "phone" },
        run: () => void list().catch(failed("The phone settings did not load.")),
      },
    ],
  }))
  return null
}

/**
 * The phone and the settings in plain sight (#704): on the home screen and at the foot of a
 * session's sidebar — a click runs the command, the slash name says how to type it.
 */
function Reach(props: { context: Plugin.Context; column?: boolean }) {
  const muted = () => props.context.theme.text.muted
  const item = (label: string, slash: string, command: string) => (
    <box flexDirection="row" gap={1} flexShrink={0} onMouseUp={() => props.context.keymap.dispatch(command)}>
      <text fg={props.context.theme.text.base}>{label}</text>
      <text fg={muted()}>{slash}</text>
    </box>
  )
  return (
    <box flexDirection={props.column ? "column" : "row"} gap={props.column ? 0 : 2} flexShrink={0}>
      {item(t("Phone"), "/phone", "buff.phone")}
      {item(t("Settings"), "/settings", "opencode.settings")}
    </box>
  )
}

export default Plugin.define({
  id: "buff.phone",
  setup(context) {
    context.ui.slot({ append: "home.footer.status", render: () => <Reach context={context} /> })
    context.ui.slot({ append: "sidebar.footer", render: () => <Reach context={context} column /> })
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
    context.ui.slot({
      append: "session.composer.top",
      render: (input) => <PhoneBanner context={context} sessionID={input.sessionID} />,
    })
  },
})
