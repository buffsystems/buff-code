// Choosing the model (#584), ported from the Solid window's model selector: a searchable list of
// the shown models grouped by provider, in a popover from the composer's model control or in a
// dialog from the "model.choose" command. Buff Code without a paid provider offers sign-in instead.

import {
  Button,
  CommandList,
  Dialog,
  DialogBody,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Kbd,
  Tooltip,
  type CommandItem,
} from "@buff/ui/react"
import { popularProviders } from "@opencode/app/react-reuse/provider-order"
import { matchesModelSearch } from "@opencode/app/react-reuse/model-search"
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../../i18n/provider"
import type { CatalogModel } from "../../../providers/models/catalog"
import type { ModelSelectionHandle } from "./use-selection"

const isFree = (model: CatalogModel) => model.provider.id === "opencode" && (!model.cost || model.cost.input === 0)
const keyOf = (model: CatalogModel) => `${model.provider.id}:${model.id}`

/** The listed models in picker order: providers by popularity then name, models by name. */
export function pickerModels(models: CatalogModel[]) {
  const rank = (id: string) => {
    const index = popularProviders.indexOf(id)
    return index < 0 ? popularProviders.length : index
  }
  return models.toSorted(
    (a, b) =>
      rank(a.provider.id) - rank(b.provider.id) ||
      a.provider.name.localeCompare(b.provider.name) ||
      a.name.localeCompare(b.name),
  )
}

function ModelList(props: { handle: ModelSelectionHandle; onSelected(): void; autoFocus?: boolean }) {
  const i18n = useI18n()
  const selection = props.handle.selection
  const models = pickerModels(selection.listed)
  const items: CommandItem[] = models.map((model) => ({
    value: keyOf(model),
    label: model.name,
    group: model.provider.name,
    keywords: [model.id, model.provider.name],
    hint: isFree(model) ? i18n.t("model.tag.free") : model.latest ? i18n.t("model.tag.latest") : undefined,
  }))
  const current = selection.model ? keyOf(selection.model) : undefined
  return (
    <CommandList
      items={items}
      label={i18n.t("dialog.model.search.placeholder")}
      placeholder={i18n.t("dialog.model.search.placeholder")}
      emptyText={i18n.t("dialog.model.empty")}
      current={current}
      autoFocus={props.autoFocus}
      filter={(item, query) => matchesModelSearch(query, [item.label, ...(item.keywords ?? [])])}
      onSelect={(item) => {
        const model = models.find((entry) => keyOf(entry) === item.value)
        if (!model) return
        props.onSelected()
        props.handle.setModel({ providerID: model.provider.id, modelID: model.id }, { recent: true })
      }}
    />
  )
}

/** The composer's model control: the current model, opening the picker. */
export function ModelControl(props: {
  handle: ModelSelectionHandle
  title: string
  keys: string[]
  onClose(): void
  onUnpaid(): void
  /** Opens «Manage models». */
  onManage(): void
}) {
  const i18n = useI18n()
  const [open, setOpen] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const selection = props.handle.selection
  const name = selection.model?.name ?? i18n.t("dialog.model.select.title")
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => content.current?.querySelector<HTMLInputElement>("input")?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])
  if (selection.loading) return null
  const hint = (
    <span className="inline-flex items-center gap-2">
      {props.title}
      {props.keys.length > 0 && <Kbd>{props.keys.join(" ")}</Kbd>}
    </span>
  )
  const label = (
    <>
      <span className="composer__select-label composer__select-label--plain">{name}</span>
      <ChevronDown aria-hidden className="size-3.5 shrink-0" />
    </>
  )
  if (!selection.paid)
    return (
      <Tooltip content={hint}>
        <Button
          data-action="composer-model"
          data-control-type="dialog"
          variant="ghost"
          size="sm"
          className="composer__select"
          onClick={props.onUnpaid}
        >
          {label}
        </Button>
      </Tooltip>
    )
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) props.onClose()
      }}
    >
      <Tooltip content={hint}>
        <PopoverTrigger asChild>
          <Button data-action="composer-model" data-control-type="popover" variant="ghost" size="sm" className="composer__select">
            {label}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        ref={content}
        side="top"
        align="start"
        sideOffset={6}
        className="composer-model-picker"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ModelList handle={props.handle} onSelected={() => setOpen(false)} />
        <ManageButton
          onClick={() => {
            setOpen(false)
            props.onManage()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function ManageButton(props: { onClick(): void }) {
  const i18n = useI18n()
  return (
    <button type="button" className="composer-model-picker__manage" data-action="model-manage" onClick={props.onClick}>
      <SlidersHorizontal aria-hidden className="size-3.5" />
      <span>{i18n.t("dialog.model.manage")}</span>
    </button>
  )
}

/** The "model.choose" command's dialog. */
export function ModelDialog(props: { handle: ModelSelectionHandle; onClose(): void; onManage(): void }) {
  const i18n = useI18n()
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} title={i18n.t("dialog.model.select.title")} closeLabel={i18n.t("common.close")}>
      <DialogBody>
        <ModelList handle={props.handle} onSelected={props.onClose} autoFocus />
        <ManageButton
          onClick={() => {
            props.onClose()
            props.onManage()
          }}
        />
      </DialogBody>
    </Dialog>
  )
}
