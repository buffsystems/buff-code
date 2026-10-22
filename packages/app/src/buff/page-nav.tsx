import { useNavigate } from "@solidjs/router"
import { Icon, type IconProps } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLayout, type LayoutRoute } from "@/shell/state/layout"
import { useCommand } from "@/shell/commands/command"
import { useBuffText } from "./i18n"

/**
 * Вход на нашу страницу (#447, #448): строка в боковой колонке, кнопка в заголовке окна без
 * колонки и команда в палитре — одинаково для «Автоматизаций» и «Сценариев».
 */

export interface Page {
  readonly path: string
  readonly route: LayoutRoute["type"]
  readonly title: string
  readonly icon: IconProps["name"]
  readonly action: string
}

export function usePageEntry(page: Page) {
  const navigate = useNavigate()
  const layout = useLayout()
  const command = useCommand()
  const { t } = useBuffText()
  const open = () => navigate(page.path)
  command.register(page.action, () => [{ id: page.action, title: t(page.title), category: "Buff", onSelect: open }])
  return { page, title: () => t(page.title), open, active: () => layout.route().type === page.route }
}

export function PageNavButton(props: { vertical: boolean; entry: ReturnType<typeof usePageEntry> }) {
  const page = () => props.entry.page
  if (!props.vertical)
    return (
      <Tooltip placement="bottom" value={props.entry.title()} class="shrink-0">
        <IconButton
          type="button"
          variant="ghost-muted"
          size="large"
          class="!w-9 shrink-0"
          icon={<Icon name={page().icon} />}
          data-action={`${page().action}-open`}
          state={props.entry.active() ? "pressed" : undefined}
          onClick={props.entry.open}
          aria-label={props.entry.title()}
        />
      </Tooltip>
    )
  return (
    <button
      type="button"
      data-titlebar-tab-action
      data-action={`${page().action}-open`}
      data-state={props.entry.active() ? "pressed" : undefined}
      class="group mb-1 flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[6px] ps-1.5 pe-2 text-[13px] leading-4 text-v2-text-text-faint hover:text-v2-text-text-base data-[state=pressed]:text-v2-text-text-base"
      onClick={props.entry.open}
      aria-label={props.entry.title()}
    >
      <Icon name={page().icon} class="shrink-0" />
      <span class="min-w-0 truncate">{props.entry.title()}</span>
    </button>
  )
}
