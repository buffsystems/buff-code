import { Button } from "@opencode/ui/button"
import { useComposerState } from "@/composer/persistence"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { FileSelection } from "@/workspaces/files/model"
import { withMention } from "./file-to-chat-prompt"
import { useBuffText } from "./i18n"
import "./file-preview.css"

/**
 * «Добавить в чат» (#451): файл из дерева или выделенные в нём строки становятся упоминанием в
 * поле ввода — видимым, как при перетаскивании файла.
 */
export function useAddFileToChat() {
  const prompt = useComposerState()
  const location = useWorkspaceLocation()
  const { t } = useBuffText()
  return (file: string, selection?: FileSelection) => {
    // Дерево отдаёт полный путь; в сообщении понятнее путь от каталога проекта.
    const root = `${location().directory}/`
    const path = file.startsWith(root) ? file.slice(root.length) : file
    const next = withMention(prompt.current(), { path, selection })
    prompt.set(next.prompt, next.cursor)
    showToast({ title: t("Added to chat"), description: next.mention })
  }
}

export function BuffSelectionToChat(props: { onAdd: () => void }) {
  const { t } = useBuffText()
  return (
    <div class="buff-selection-to-chat" data-component="buff-selection-to-chat">
      <Button size="small" variant="neutral" icon="plus" data-action="buff-selection-to-chat" onClick={props.onAdd}>
        {t("Add selection to chat")}
      </Button>
    </div>
  )
}
