import type { ParentProps } from "solid-js"
import { useSettingsCommand } from "@/settings/command"
import "./page-panel.css"

/**
 * Страница Buff (#447, #448) — на панели, как главная (#471): карточка на рамке окна, колонка по центру.
 * Ctrl+, открывает настройки и отсюда, как с экранов сессии и главной (#472, найдено проходом).
 */
export function BuffPage(props: ParentProps<{ component: string }>) {
  useSettingsCommand()
  return (
    <div class="buff-page-panel">
      <div class="buff-page" data-component={props.component}>
        {props.children}
      </div>
    </div>
  )
}
