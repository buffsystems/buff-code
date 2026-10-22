// Adding a WSL distro as a server (#584), ported from the Solid window's wsl/dialog.tsx over its
// framework-free model: pick an installed distro (or install one from the catalog), install or
// update OpenCode in it, add it. Without WSL the dialog offers to install it.

import {
  ActionRow,
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogFooter,
  IconTile,
  Input,
  RadioGroup,
  RadioItem,
  Spinner,
} from "@buff/ui/react"
import {
  addServerProbePlan,
  addServerViewModel,
  createProbeFailureGate,
  runAddableProbePlan,
  type AddServerProbePlan,
  type AddServerText,
} from "@opencode/app/react-reuse/wsl-model"
import type { WslServersPlatform } from "@opencode/app/wsl/types"
import { Download } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { showToast } from "../../shell/notifications/toast"
import { useWslState } from "../remote-state"

const runtimeMissing = (error: string | null | undefined) =>
  !error || /WSL is not installed|not been installed|wsl(?:\.exe)? --install/i.test(error)

export function WslAddDialog(props: { onClose: () => void; onAdded?: (distro: string) => void | Promise<void> }) {
  const api = usePlatform().wslServers
  if (!api) return null
  return <WslAdd api={api} {...props} />
}

function WslAdd(props: {
  api: WslServersPlatform
  onClose: () => void
  onAdded?: (distro: string) => void | Promise<void>
}) {
  const i18n = useI18n()
  const state = useWslState()
  const [view, setView] = useState<"main" | "catalog">("main")
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [target, setTarget] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [probing, setProbing] = useState<AddServerProbePlan["kind"]>()
  const gate = useRef(createProbeFailureGate())
  const text = (value: AddServerText) => (value.params ? i18n.t(value.key, value.params) : i18n.t(value.key))
  const failed = (error: unknown) =>
    showToast({
      variant: "error",
      title: i18n.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  const viewModel = (probingAddable: boolean) =>
    addServerViewModel({
      state,
      view,
      selectedDistro: selected,
      catalogSearch: search,
      catalogTarget: target,
      adding,
      probingAddable,
    })
  const base = viewModel(false)
  const model = viewModel(probing === "addable")

  // The dialog probes the runtime, the distros and the addable distros as it needs them.
  useEffect(() => {
    if (probing) return
    const command = addServerProbePlan({
      state,
      view,
      adding,
      busy: base.busy,
      selectedDistro: base.selectedDistro,
      addableInstalledDistros: base.addableInstalledDistros,
    })
    if (!command || !gate.current.accepts(command.key)) return
    setProbing(command.kind)
    const task =
      command.kind === "addable"
        ? runAddableProbePlan({ plan: command.plan, api: props.api })
        : command.plan.action === "probeRuntime"
          ? props.api.probeRuntime()
          : props.api.refreshDistros()
    void task
      .then(
        () => gate.current.settle(command.key, undefined),
        (error: unknown) => {
          gate.current.settle(command.key, error)
          failed(error)
        },
      )
      .finally(() => setProbing(undefined))
  })

  const run = (action: () => Promise<unknown>) => void action().catch(failed)
  const refresh = () =>
    run(async () => {
      gate.current.reset()
      await props.api.refreshDistros()
    })
  const install = () => {
    const name = model.catalogTarget
    if (model.installingCatalogDistro || !name) return
    run(async () => {
      gate.current.reset()
      await props.api.installDistro(name)
      setView("main")
    })
  }
  const primary = async () => {
    const button = model.primaryButton
    const distro = model.selectedDistro
    if (button.loading || !distro || !button.action) return
    if (button.action === "install-opencode") return run(() => props.api.installOpencode(distro))
    setAdding(true)
    try {
      await props.api.addServer(distro)
      if (props.onAdded) await props.onAdded(distro)
      if (!props.onAdded) props.onClose()
    } catch (error) {
      failed(error)
    } finally {
      setAdding(false)
    }
  }
  const close = (open: boolean) => !open && props.onClose()

  if (!state)
    return (
      <Dialog open onOpenChange={close} title={i18n.t("wsl.server.add")} size="sm">
        <DialogBody>
          <Spinner label={i18n.t("wsl.onboarding.loading")} />
        </DialogBody>
      </Dialog>
    )
  if (model.runtimeState === "checking" || model.runtimeState === "loading")
    return (
      <Dialog open onOpenChange={close} title={i18n.t("wsl.server.add")} size="sm">
        <DialogBody>
          <Spinner label={i18n.t("wsl.onboarding.checkingRuntime")} />
        </DialogBody>
      </Dialog>
    )
  if (model.runtimeState !== "ready") {
    const error = state.runtime?.error ?? null
    const installable = runtimeMissing(error)
    const restart = model.runtimeState === "pendingRestart"
    const title = restart
      ? i18n.t("wsl.onboarding.restartRequired")
      : i18n.t(installable ? "wsl.onboarding.wslNotInstalled.title" : "wsl.onboarding.wslUnavailable.title")
    const description = restart
      ? i18n.t("wsl.onboarding.windowsRestartRequired")
      : i18n.t(installable ? "wsl.onboarding.wslNotInstalled.description" : "wsl.onboarding.wslUnavailable.description")
    return (
      <Dialog open onOpenChange={close} title={title} description={description} size="sm">
        <DialogBody>{!installable && error && <Callout tone="crit">{error}</Callout>}</DialogBody>
        <DialogFooter>
          {model.runtimeState === "unavailable" && installable ? (
            <Button disabled={model.busy} onClick={() => run(() => props.api.installWsl())}>
              {i18n.t("wsl.onboarding.installWsl")}
            </Button>
          ) : (
            <Button onClick={props.onClose}>{i18n.t("common.close")}</Button>
          )}
        </DialogFooter>
      </Dialog>
    )
  }

  if (view === "catalog")
    return (
      <Dialog open onOpenChange={close} title={i18n.t("wsl.onboarding.installDistro")} size="sm" hideClose>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Input
              value={search}
              placeholder={i18n.t("wsl.onboarding.searchDistros")}
              aria-label={i18n.t("wsl.onboarding.searchDistros")}
              disabled={model.busy}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <RadioGroup
              aria-label={i18n.t("wsl.onboarding.installDistro")}
              value={model.catalogTarget ?? undefined}
              onValueChange={setTarget}
              disabled={model.busy}
            >
              {model.filteredInstallableDistros.map((item) => (
                <RadioItem key={item.name} value={item.name} label={item.label} />
              ))}
            </RadioGroup>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            disabled={model.busy}
            onClick={() => {
              gate.current.reset()
              setView("main")
              setSearch("")
              setTarget(null)
            }}
          >
            {i18n.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={model.installingCatalogDistro}
            disabled={model.busy || !model.catalogTarget}
            onClick={install}
          >
            {i18n.t("wsl.onboarding.installDistro")}
          </Button>
        </DialogFooter>
      </Dialog>
    )

  const button = model.primaryButton
  return (
    <Dialog open onOpenChange={close} title={i18n.t("wsl.server.add")} size="sm" hideClose>
      <DialogBody>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="ui-title ui-title--sm">{i18n.t("wsl.onboarding.installedDistros")}</span>
            <Button variant="ghost" size="sm" disabled={model.busy} onClick={refresh}>
              {i18n.t("wsl.onboarding.checkAgain")}
            </Button>
          </div>
          {model.addableInstalledDistros.length === 0 ? (
            <p className="ui-note">
              {i18n.t(
                model.visibleInstalledDistros.length ? "wsl.onboarding.allDistrosAdded" : "wsl.onboarding.noDistros",
              )}
            </p>
          ) : (
            <RadioGroup
              aria-label={i18n.t("wsl.onboarding.installedDistros")}
              value={model.selectedDistro ?? undefined}
              onValueChange={setSelected}
              disabled={model.busy}
            >
              {model.addableInstalledDistros.map((item) => {
                const status = model.distroStatuses[item.name]
                return (
                  <RadioItem
                    key={item.name}
                    value={item.name}
                    disabled={item.version === 1 || model.busy}
                    label={item.name}
                    hint={status ? text(status.label) : undefined}
                  />
                )
              })}
            </RadioGroup>
          )}
          {model.installableDistros.length > 0 && (
            <ActionRow
              icon={<IconTile icon={Download} size="sm" />}
              title={i18n.t("wsl.onboarding.needAnotherDistro")}
              hint={i18n.t("wsl.onboarding.needAnotherDistroHint")}
              chevron
              disabled={model.busy}
              onClick={() => {
                setView("catalog")
                setSearch("")
                setTarget(model.installableDistros[0]?.name ?? null)
              }}
            />
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button disabled={adding} onClick={props.onClose}>
          {i18n.t("common.cancel")}
        </Button>
        <Button
          variant={button.variant === "contrast" ? "primary" : "outline"}
          loading={button.loading}
          disabled={!button.loading && button.disabled}
          onClick={() => void primary()}
        >
          {text(button.label)}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
