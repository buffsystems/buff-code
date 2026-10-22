import { createSignal } from "solid-js"
import open from "open"
import { useRenderer } from "@opentui/solid"
import { useClipboard } from "../context/clipboard"
import { useDialog } from "./dialog"
import { DialogSelect } from "./dialog-select"
import { useToast } from "./toast"
import { t } from "../feature-plugins/buff/locale"

export function useWorkingDirectoryActions(input: { directory: () => string | undefined; onMove?: () => void }) {
  const clipboard = useClipboard()
  const dialog = useDialog()
  const renderer = useRenderer()
  const toast = useToast()
  const [hovered, setHovered] = createSignal(false)

  function openMenu() {
    if (renderer.getSelection()?.getSelectedText()) return
    const directory = input.directory()
    if (!directory) return
    dialog.replace(() => (
      <DialogSelect
        title={t("Working directory")}
        renderFilter={false}
        options={[
          {
            title: t("Copy path"),
            value: "location.copy",
            description: directory,
            onSelect: (dialog) => {
              void clipboard.write(directory).then(() => {
                dialog.clear()
                toast.show({ message: t("Path copied to clipboard"), variant: "info" })
              }, toast.error)
            },
          },
          {
            title: t("Open folder"),
            value: "location.open",
            description: t("in system file manager"),
            onSelect: (dialog) => {
              dialog.clear()
              void open(directory).catch(toast.error)
            },
          },
          ...(input.onMove
            ? [
                {
                  title: t("Workspaces"),
                  value: "session.move",
                  description: t("to another working directory"),
                  onSelect: () => void input.onMove?.(),
                },
              ]
            : []),
        ]}
      />
    ))
  }

  return {
    hovered,
    onMouseOver: () => setHovered(true),
    onMouseOut: () => setHovered(false),
    onMouseUp: openMenu,
  }
}
