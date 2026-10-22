import type { LocationRef } from "@opencode/client/promise"
import { failureMessage } from "@opencode/schema/buff-failure"
import { BuffProvider } from "@opencode/schema/buff-provider"
import { BuffProviderFlow } from "@opencode/schema/buff-provider-flow"
import type { useClient } from "../context/client"
import type { useData } from "../context/data"
import { createDialogApi } from "../plugin/api"
import type { useDialog } from "../ui/dialog"
import type { useToast } from "../ui/toast"
import { t } from "../feature-plugins/buff/locale"

/**
 * Свой OpenAI-совместимый сервер и проверка модели в консоли (#562) — те же действия, что в окне:
 * шаги — общие (`BuffProviderFlow`), хранит и проверяет ядро (rpc `buff.provider`).
 */

type Deps = {
  readonly dialog: ReturnType<typeof useDialog>
  readonly client: ReturnType<typeof useClient>
  readonly data: ReturnType<typeof useData>
  readonly toast: ReturnType<typeof useToast>
  readonly location: LocationRef
}

const rpc = (deps: Deps) => deps.client.api.rpc(BuffProvider.Rpc)
const at = (deps: Deps) => ({ location: deps.location })

/** Вопросы по очереди, запись в ядро; вернуть идентификатор нового провайдера. */
export async function addOwnProvider(deps: Deps, preset: BuffProvider.Preset): Promise<string | undefined> {
  const api = createDialogApi(deps.dialog, (render) => render())
  const ui: BuffProviderFlow.Ui = { select: (dialog) => api.select(dialog), prompt: (dialog) => api.prompt(dialog), t }
  const draft = await BuffProviderFlow.add(
    ui,
    (input) =>
      rpc(deps)
        .models(input, at(deps))
        .catch((cause: unknown) => ({ error: { type: "unknown", message: failureMessage(cause, String(cause)) } })),
    preset,
  )
  if (!draft) return
  if ("problem" in draft) {
    deps.toast.show({ variant: "error", message: draft.problem })
    return
  }
  const saved = await rpc(deps)
    .save(draft, at(deps))
    .then(
      () => true,
      (cause: unknown) => {
        deps.toast.show({ variant: "error", message: failureMessage(cause, t("Could not save.")) })
        return false
      },
    )
  if (!saved) return
  const { data, location } = deps
  data.location.integration.invalidate(location)
  data.location.model.invalidate(location)
  data.location.provider.invalidate(location)
  await Promise.all([
    data.location.integration.sync(location),
    data.location.model.sync(location),
    data.location.provider.sync(location),
  ]).catch(() => undefined)
  deps.toast.show({ variant: "success", message: t("Connected {name}", { name: draft.name }) })
  return draft.id
}

/** Короткий запрос к модели: ответ и время или отказ — теми же словами, что отказ хода. */
export async function checkModel(deps: Deps, model: { providerID: string; modelID: string } | undefined) {
  const api = createDialogApi(deps.dialog, (render) => render())
  if (!model)
    return api.alert({ title: t("Check the model"), message: t("No model is chosen — choose one in /models.") })
  const provider =
    deps.data.location.provider.list(deps.location)?.find((item) => item.id === model.providerID)?.name ??
    model.providerID
  const label = `${provider} · ${model.modelID}`
  deps.toast.show({ variant: "info", message: t("Checking {model}…", { model: label }) })
  const result = await rpc(deps)
    .test({ providerID: model.providerID, modelID: model.modelID }, at(deps))
    .catch(
      (cause: unknown): BuffProvider.Checked => ({
        error: { type: "unknown", message: failureMessage(cause, String(cause)) },
      }),
    )
  const checked = BuffProviderFlow.checked(result, model.providerID, provider, t)
  return api.alert({ title: t("Check {provider}", { provider: label }), message: checked.text })
}
