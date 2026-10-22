// «Manage models» (#584), ported from the Solid window's providers/models/manage.tsx: the same
// visibility groups as the Models settings, in a dialog the model picker opens, with a switch per
// provider and «Connect provider» beside the title.

import { Button, Dialog, DialogBody, IconButton, Input } from "@buff/ui/react"
import { Plus, X } from "lucide-react"
import { useState } from "react"
import type { Server } from "../../core/servers"
import type { DialogStack } from "../../dialog/dialogs"
import { useDialog } from "../../dialog/dialogs"
import { useI18n } from "../../i18n/provider"
import { useProviderCatalog } from "../catalog/use-catalog"
import { openConnectProvider } from "../connect/open"
import { ModelVisibilityGroups } from "./visibility-groups"

export function DialogManageModels(props: { server: Server; directory?: string; onClose: () => void }) {
  const i18n = useI18n()
  const dialog = useDialog()
  const catalog = useProviderCatalog(props.server, props.directory)
  const [filter, setFilter] = useState("")
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && props.onClose()}
      title={i18n.t("dialog.model.manage")}
      description={i18n.t("dialog.model.manage.description")}
      closeLabel={i18n.t("common.close")}
    >
      <DialogBody>
        <div className="flex min-h-0 flex-col gap-3" data-component="manage-models">
          <div className="flex items-center gap-2">
            <Input
              type="search"
              className="flex-1"
              autoFocus
              value={filter}
              placeholder={i18n.t("dialog.model.search.placeholder")}
              aria-label={i18n.t("dialog.model.search.placeholder")}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
            {filter && (
              <IconButton icon={X} size="xs" aria-label={i18n.t("common.clear")} onClick={() => setFilter("")} />
            )}
            <Button
              leadingIcon={Plus}
              onClick={() => openConnectProvider(dialog, { server: props.server, directory: props.directory })}
            >
              {i18n.t("command.provider.connect")}
            </Button>
          </div>
          <div
            className="settings-models flex max-h-[min(60vh,520px)] flex-col gap-3 overflow-y-auto"
            data-slot="manage-models-scroll"
          >
            <ModelVisibilityGroups
              models={catalog.models}
              ready={catalog.ready}
              filter={filter}
              collapsed={collapsed}
              onCollapse={(provider, value) => setCollapsed((current) => ({ ...current, [provider]: value }))}
              providerSwitch
            />
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

export function openManageModels(dialog: DialogStack, input: { server: Server; directory?: string }) {
  return dialog.show((close) => (
    <DialogManageModels server={input.server} directory={input.directory} onClose={close} />
  ))
}
