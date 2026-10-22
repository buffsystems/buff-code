// The side panes' window-wide state (#584): the persisted layout and one file model per workspace,
// created once per window (per Core) and shared by every session screen, as the Solid window's
// layout and file providers are.

import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import type { Core } from "../../react/core"
import type { Server } from "../../core/servers"
import { createFiles, type Files } from "./files/model"
import { createPanesLayout, type PanesLayout } from "./layout"

export type FilesErrors = { load: string; list: string; translate: (key: string) => string }

export type PanesWindow = {
  layout: PanesLayout
  /** The file model of one workspace of a server; the first call subscribes it to the server's events. */
  files(server: Server, directory: string, errors: FilesErrors): Files
}

const windows = new WeakMap<Core, PanesWindow>()

export function panesWindow(core: Core, notify: (title: string, description: string) => void): PanesWindow {
  const existing = windows.get(core)
  if (existing) return existing
  // Per server controller: a server that is created again gets new models on its own event bus.
  const files = new WeakMap<Server, Map<string, Files>>()
  const created: PanesWindow = {
    layout: createPanesLayout(core.platform.storage("opencode.global.dat")),
    files(server, directory, errors) {
      const models = files.get(server) ?? new Map<string, Files>()
      files.set(server, models)
      const known = models.get(directory)
      if (known) return known
      const model = createFiles({
        api: server.api,
        directory,
        onError: (kind, message) => notify(kind === "load" ? errors.load : errors.list, message),
        formatError: (error) => formatServerError(error, errors.translate, errors.translate("error.chain.unknown")),
      })
      server.event.location(directory).listen(model.handle)
      models.set(directory, model)
      return model
    },
  }
  windows.set(core, created)
  return created
}
