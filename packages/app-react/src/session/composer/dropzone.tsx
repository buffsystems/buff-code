// The dropzone over the screen while files are dragged (#584), ported from the Solid composer's
// ComposerDropzone: it names what the model will take inline.

import { Upload } from "lucide-react"
import { useI18n } from "../../i18n/provider"
import { useStore } from "../../react/use-store"
import { dropState } from "./drop"
import "./composer.css"

export function Dropzone() {
  const i18n = useI18n()
  const state = useStore(dropState, (value) => value)
  if (!state.active) return null
  const input = state.input
  const label = !input?.image && !input?.pdf
    ? i18n.t("ui.promptInput.dropFiles")
    : !input.pdf
      ? i18n.t("ui.promptInput.dropFiles.image")
      : !input.image
        ? i18n.t("ui.promptInput.dropFiles.pdf")
        : i18n.t("ui.promptInput.dropFiles.imagePdf")
  return (
    <div data-component="session-dropzone" data-visible="true" className="composer-dropzone">
      <div className="flex flex-col items-center gap-4">
        <Upload aria-hidden className="size-5" />
        <span>{label}</span>
      </div>
    </div>
  )
}
