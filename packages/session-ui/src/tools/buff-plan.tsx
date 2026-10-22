import { createSignal, Show } from "solid-js"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffPlan } from "@opencode/schema/buff-plan"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import { BasicTool } from "../components/basic-tool"
import { Markdown } from "../components/markdown"
import { writeClipboard } from "../message/message-content"
import { registerTool } from "./tool-renderer"
import "./buff-plan.css"

/**
 * Карточка плана Buff (#463), как в ZCode: план агента из режима «План» — свёрнутый текст,
 * «Показать целиком», «Копировать» и состояние. Ответ — «Утвердить и начать» или замечание —
 * человек даёт в доке вопроса над полем ввода.
 */

registerTool({
  name: BuffPlan.TOOL,
  render(props) {
    // Язык окна приходит через i18n интерфейса; строки Buff — из каталога Buff (#472).
    const i18n = useI18n()
    const t: BuffI18n.T = (text, params) => BuffI18n.t(BuffI18n.locale(i18n.locale()), text, params)
    const [full, setFull] = createSignal(false)
    const [copied, setCopied] = createSignal(false)
    const plan = () => (typeof props.input.plan === "string" ? props.input.plan : "")
    const copy = () =>
      void writeClipboard(plan()).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    return (
      <BasicTool
        {...props}
        icon="checklist"
        defaultOpen
        hasContent={!!plan()}
        trigger={{
          title: t("Plan"),
          subtitle: BuffPlan.state(BuffPlan.decisionOf(props.metadata), props.status ?? "", t),
        }}
      >
        <div data-component="buff-plan" data-full={full()}>
          <div data-slot="buff-plan-text">
            <Markdown text={plan()} />
          </div>
          <div data-slot="buff-plan-actions">
            <Button size="small" variant="ghost" data-action="buff-plan-full" onClick={() => setFull(!full())}>
              {full() ? t("Collapse") : t("Show in full")}
            </Button>
            <Button size="small" variant="ghost" data-action="buff-plan-copy" onClick={copy}>
              <Show when={copied()} fallback={t("Copy")}>
                {t("Copied")}
              </Show>
            </Button>
          </div>
        </div>
      </BasicTool>
    )
  },
})
