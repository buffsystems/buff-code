import { Button } from "@opencode/ui/button"
import { SettingsRow } from "@/settings/row"
import { useBuffText } from "./i18n"
import { BuffTextSize } from "./text-size"
import "./text-size-settings.css"

/**
 * Размер шрифта в настройках оформления (#461): интерфейс и код — ползунками, с образцом,
 * который меняется сразу. «Сбросить» возвращает прежние размеры.
 */

function SizeSlider(props: {
  label: string
  value: number
  range: { min: number; max: number }
  onInput: (value: number) => void
  action: string
}) {
  return (
    <div class="buff-size-control">
      <input
        type="range"
        min={props.range.min}
        max={props.range.max}
        step={1}
        value={props.value}
        aria-label={props.label}
        data-action={props.action}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <span class="buff-size-value">{props.value} px</span>
    </div>
  )
}

export function BuffTextSizeRows() {
  const { t } = useBuffText()
  return (
    <>
      <SettingsRow
        title={t("Interface font size")}
        description={<span class="buff-size-sample">{t("This is how labels, menus and messages will look.")}</span>}
      >
        <SizeSlider
          label={t("Interface font size")}
          value={BuffTextSize.ui()}
          range={BuffTextSize.UI}
          onInput={BuffTextSize.setUi}
          action="buff-size-ui"
        />
      </SettingsRow>
      <SettingsRow
        title={t("Code font size")}
        description={
          <code class="buff-size-sample buff-size-sample--code">const answer = await buff.ask(question)</code>
        }
      >
        <SizeSlider
          label={t("Code font size")}
          value={BuffTextSize.code()}
          range={BuffTextSize.CODE}
          onInput={BuffTextSize.setCode}
          action="buff-size-code"
        />
      </SettingsRow>
      <SettingsRow
        title={t("Default sizes")}
        description={t("Files, changes, code blocks in answers and the terminal too.")}
      >
        <Button size="normal" variant="neutral" data-action="buff-size-reset" onClick={BuffTextSize.reset}>
          {t("Reset")}
        </Button>
      </SettingsRow>
    </>
  )
}
