import { createResource, createSignal, Show } from "solid-js"
import { BuffSnapshotGit } from "@opencode/schema/buff-snapshot-git"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useBuffText } from "./i18n"
import "./snapshot-git.css"

// «Скрыть» — до перезапуска окна: git на машине за это время не поменяется.
const [hidden, setHidden] = createSignal(false)

/**
 * Полоса над полем ввода (#495): снимкам сессии не хватает git от 2.35 — откат и изменения
 * сессии не работают. Раньше снимок терялся молча; слова — общие с консолью (`BuffSnapshotGit`).
 */
export function BuffSnapshotGitStrip() {
  const sdk = useServerSDK()
  const location = useWorkspaceLocation()
  const { t } = useBuffText()
  const rpc = sdk.api.rpc(BuffSnapshotGit.Rpc)
  const [status] = createResource(
    () => (sdk.connection.status() === "connected" ? location().directory : undefined),
    (directory) => rpc.status(undefined, { location: { directory } }).catch(() => undefined),
  )
  const text = () => {
    const current = status()
    return current && !hidden() ? BuffSnapshotGit.warning(current, t) : undefined
  }
  return (
    <Show when={text()}>
      {(warning) => (
        <div class="buff-snapshot-git" data-component="buff-snapshot-git">
          <Icon name="outline-hexagonal-warning" class="shrink-0" />
          <span class="min-w-0 flex-1">{warning()}</span>
          <Button size="small" variant="ghost" data-action="buff-snapshot-git-hide" onClick={() => setHidden(true)}>
            {t("Hide")}
          </Button>
        </div>
      )}
    </Show>
  )
}
