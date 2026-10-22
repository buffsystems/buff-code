// Which changes the review shows (#584): the Solid review title's select — a button naming the
// current mode ("Git changes", "Branch changes") that opens the list of modes the workspace offers.

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@buff/ui/react"
import { Check, ChevronDown } from "lucide-react"
import { useI18n } from "../../../i18n/provider"
import type { ChangeMode } from "../layout"

export function ReviewModeMenu(props: { options: ChangeMode[]; mode: ChangeMode; onSelect: (mode: ChangeMode) => void }) {
  const i18n = useI18n()
  const label = (option: ChangeMode) =>
    option === "git"
      ? i18n.t("ui.sessionReview.title.git")
      : option === "branch"
        ? i18n.t("ui.sessionReview.title.branch")
        : i18n.t("ui.sessionReview.title.lastTurn")
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" trailingIcon={ChevronDown} data-component="review-mode-menu">
          {label(props.mode)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.options.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => props.onSelect(option)}>
            <span className="flex-1">{label(option)}</span>
            {option === props.mode && <Check aria-hidden className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
