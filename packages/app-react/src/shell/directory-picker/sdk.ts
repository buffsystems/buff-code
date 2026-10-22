// The picker's listing helpers take the Solid window's server SDK; they read only its API client,
// which a React server controller provides as is.

import type { listPickerDirectory } from "@opencode/app/react-reuse/directory-picker"
import type { Server } from "../../core/servers"

export type PickerSdk = Parameters<typeof listPickerDirectory>[0]

export function pickerSdk(server: Server): PickerSdk {
  return { api: server.api() } as Pick<PickerSdk, "api"> as PickerSdk
}
