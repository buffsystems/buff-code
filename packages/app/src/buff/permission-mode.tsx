import { createEffect, createMemo, createSignal, on } from "solid-js"
import { useParams } from "@solidjs/router"
import { BuffPermissionMode as Mode } from "@opencode/schema/buff-permission-mode"
import { Select } from "@opencode/ui/select"
import { useLocal } from "@/providers/models/selection"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"
import { useBuffText } from "./i18n"
import "./permission-mode.css"

/**
 * Режим разрешений в поле ввода (#450): сколько агенту доверяют в этой сессии — спрашивать перед
 * правками и командами, править самому, не спрашивать внутри проекта — и отметка «План».
 * Режим — правила сессии, отметка — агент плана; ядро и то и другое уже умеет. У ещё не созданной
 * сессии выбор запоминается и уходит вместе с её созданием.
 */

const PLAN = "plan"
const KEY = "buff.permission-mode"

/** Режим, выбранный последним: с него начинается новая сессия. По умолчанию — как было до режимов. */
function remembered(): Mode.Mode {
  try {
    const stored = localStorage.getItem(KEY)
    return Mode.MODES.find((mode) => mode.value === stored)?.value ?? "full"
  } catch {
    return "full"
  }
}
const [preferred, setPreferred] = createSignal<Mode.Mode>(remembered())
const prefer = (mode: Mode.Mode) => {
  setPreferred(mode)
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // Без хранилища выбор живёт до перезапуска окна.
  }
}

// Начинать ли новые сессии в «Плане» (#457): выбирается в знакомстве по роду занятий.
const PLAN_KEY = "buff.plan-by-default"
function planRemembered(): boolean {
  try {
    return localStorage.getItem(PLAN_KEY) === "true"
  } catch {
    return false
  }
}

/** Режим и «План» для новых сессий — из знакомства (#457). */
export function preferForNewSessions(mode: Mode.Mode, plan: boolean): void {
  prefer(mode)
  try {
    localStorage.setItem(PLAN_KEY, String(plan))
  } catch {
    // Без хранилища выбор живёт до перезапуска окна.
  }
}

/** Правила для новой сессии — по запомненному режиму. */
export function newSessionPermissions(agent: string | undefined) {
  return Mode.rules(preferred(), agent === PLAN)
}

export function BuffPermissionModeControl() {
  const params = useParams<{ id?: string }>()
  const data = useData()
  const sdk = useServerSDK()
  const local = useLocal()
  const { t } = useBuffText()
  const plan = createMemo(() => local.agent.current()?.name === PLAN)
  const hasPlan = createMemo(() => local.agent.list().some((agent) => agent.name === PLAN))
  const session = createMemo(() => (params.id ? data.session.get(params.id) : undefined))
  const mode = createMemo(() => (session() ? Mode.modeOf(session()!.permissions, plan()) : preferred()))
  const options = createMemo(() => [
    ...(mode()
      ? []
      : [{ value: "custom" as const, label: Mode.short(undefined, t), hint: t("The rules of this session are not set by a mode.") }]),
    ...Mode.MODES.map((item) => ({ ...item, label: t(item.label), hint: t(item.hint) })),
  ])

  /** Записать правила сессии; у ещё не созданной сессии режим просто запоминается. */
  const apply = (next: Mode.Mode, planned: boolean) => {
    prefer(next)
    const sessionID = params.id
    if (!sessionID) return
    void sdk.api.session.update({ sessionID, permissions: Mode.rules(next, planned) }).catch((error: unknown) =>
      showToast({
        title: t("Permission mode"),
        description: formatServerError(error, undefined, t("Could not change the mode.")),
      }),
    )
  }
  // Новая сессия начинается в «Плане», если так выбрано в знакомстве (#457).
  createEffect(
    on(hasPlan, (ready) => {
      if (ready && !params.id && planRemembered() && !plan()) local.agent.set(PLAN)
    }),
  )
  const togglePlan = () => {
    const next = !plan()
    // Вернуться из плана — к агенту, с которого в него вошли; иначе к основному.
    local.agent.set(next ? PLAN : (local.agent.list().find((agent) => agent.name !== PLAN)?.name ?? "build"))
    apply(mode() ?? preferred(), next)
  }

  return (
    <div class="buff-mode" data-component="buff-permission-mode" data-mode={mode() ?? "custom"}>
      <Select
        data-action="buff-permission-mode"
        options={options()}
        current={options().find((option) => option.value === (mode() ?? "custom"))}
        value={(option) => option.value}
        label={(option) => (option.value === "custom" ? option.label : Mode.short(option.value, t))}
        placement="top-start"
        gutter={6}
        onSelect={(option) => option && option.value !== "custom" && apply(option.value, plan())}
      >
        {(option) => (
          <div class="buff-mode-option">
            <span class="text-13-medium text-text-strong">{option?.label}</span>
            <span class="text-12-regular text-text-weak">{option?.hint}</span>
          </div>
        )}
      </Select>
      <button
        type="button"
        class="buff-mode-plan"
        data-action="buff-plan-toggle"
        data-active={plan()}
        hidden={!hasPlan()}
        title={
          plan()
            ? t("Plan: the agent only reads and drafts a plan. Click to get back to work.")
            : t("Turn on the plan: the agent does not edit files, it drafts a plan.")
        }
        onClick={togglePlan}
      >
        {t("Plan")}
      </button>
    </div>
  )
}
