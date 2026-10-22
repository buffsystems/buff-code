import { createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import { useBuffSettingsDirectory } from "@/buff/settings-directory"
import { ModelsProvider } from "@/providers/models/models"
import { ServerProvider } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"

// Buff (#466): каталог данных настроек — см. `@/buff/settings-directory`.
const BuffDirectory = createContext<Accessor<string | undefined>>(() => undefined)
export const useSettingsDirectory = () => useContext(BuffDirectory)

function BuffSettingsDirectory(props: ParentProps<{ directory?: string }>) {
  const directory = useBuffSettingsDirectory(() => props.directory)
  return (
    <BuffDirectory.Provider value={directory}>
      <ModelsProvider directory={directory}>{props.children}</ModelsProvider>
    </BuffDirectory.Provider>
  )
}

export function SettingsServerDataScope(props: ParentProps<{ server: ServerConnection.Any; directory?: string }>) {
  return (
    <ServerProvider conn={props.server}>
      <BuffSettingsDirectory directory={props.directory}>{props.children}</BuffSettingsDirectory>
    </ServerProvider>
  )
}
