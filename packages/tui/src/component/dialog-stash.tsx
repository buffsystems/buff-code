import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { createMemo, createSignal } from "solid-js"
import { Locale } from "../util/locale"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { usePromptStash, type StashEntry } from "../prompt/stash"
import { n, t } from "../feature-plugins/buff/locale"

function getRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return t("just now")
  if (minutes < 60) return t("{n}m ago", { n: minutes })
  if (hours < 24) return t("{n}h ago", { n: hours })
  if (days < 7) return t("{n}d ago", { n: days })
  return Locale.datetime(timestamp)
}

function getStashPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

export function DialogStash(props: { onSelect: (entry: StashEntry) => void }) {
  const dialog = useDialog()
  const stash = usePromptStash()
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()

  const [toDelete, setToDelete] = createSignal<number>()

  const options = createMemo(() => {
    const entries = stash.list()
    // Show most recent first
    return entries
      .map((entry, index) => {
        const isDeleting = toDelete() === index
        const lineCount = (entry.prompt.text.match(/\n/g)?.length ?? 0) + 1
        return {
          title: isDeleting
            ? t("Press {key} again to confirm", { key: shortcuts.get("stash.delete") ?? "" })
            : getStashPreview(entry.prompt.text),
          bg: isDeleting ? theme.background.action.destructive.focused : undefined,
          fg: isDeleting ? theme.text.action.destructive.focused : undefined,
          value: index,
          description: getRelativeTime(entry.timestamp),
          footer: lineCount > 1 ? n(lineCount, "~{n} line|~{n} lines") : undefined,
        }
      })
      .toReversed()
  })

  return (
    <DialogSelect
      title={t("Stash")}
      options={options()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        const entries = stash.list()
        const entry = entries[option.value]
        if (entry) {
          stash.remove(option.value)
          props.onSelect(entry)
        }
        dialog.clear()
      }}
      actions={[
        {
          command: "stash.delete",
          title: t("delete"),
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              stash.remove(option.value)
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
      ]}
    />
  )
}
