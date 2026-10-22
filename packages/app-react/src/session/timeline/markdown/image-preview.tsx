import { Dialog } from "@buff/ui/react"
import { createContext, use, useCallback } from "react"
import { useDialog } from "../../../dialog/dialogs"
import { useI18n } from "../../../i18n/provider"
import type { ReadMarkdownImage } from "./images"

/** How the timeline reads a local image (a path the browser cannot load): through the server. */
export const ReadImageContext = createContext<ReadMarkdownImage | undefined>(undefined)

export function useReadImage() {
  return use(ReadImageContext)
}

/** Open an image of the transcript large, in a dialog. */
export function usePreviewImage() {
  const dialog = useDialog()
  const i18n = useI18n()
  return useCallback(
    (src: string, alt: string) =>
      dialog.show((close) => (
        <Dialog
          open
          size="xl"
          title={alt || i18n.t("ui.imagePreview.alt")}
          closeLabel={i18n.t("ui.common.close")}
          onOpenChange={(open) => !open && close()}
        >
          <img src={src} alt={alt} className="max-h-[75vh] w-full object-contain" />
        </Dialog>
      )),
    [dialog, i18n],
  )
}

/** Make every image under `root` open the preview, by click or Enter/Space, as the Solid window does. */
export function previewImages(root: HTMLElement, open: (src: string, alt: string) => void, label: string) {
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    image.setAttribute("role", "button")
    image.setAttribute("aria-haspopup", "dialog")
    image.setAttribute("aria-label", image.alt || label)
    image.tabIndex = 0
    const show = (event: Event) => {
      const src = image.currentSrc || image.getAttribute("src")
      if (!src) return
      event.preventDefault()
      event.stopPropagation()
      open(src, image.alt)
    }
    image.onclick = show
    image.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") show(event)
    }
  })
}
