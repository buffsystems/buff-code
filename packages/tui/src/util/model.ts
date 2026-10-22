import { t } from "../feature-plugins/buff/locale"
export function parse(value: string) {
  const [providerID, ...modelID] = value.split("/")
  return { providerID, modelID: modelID.join("/") }
}

export function formatRef(model: { providerID: string; id: string; variant?: string }) {
  return [model.providerID, model.id, model.variant].filter((value) => value !== undefined).join("/")
}

export function switchLabel(
  model: { providerID: string; id: string; variant?: string },
  models?: readonly { providerID: string; id: string; name: string }[],
  previous?: { providerID: string; id: string; variant?: string },
) {
  if (previous?.providerID === model.providerID && previous.id === model.id)
    return t("Switched variant to {variant}", { variant: model.variant ?? t("default") })
  const display = models?.find((item) => item.providerID === model.providerID && item.id === model.id)?.name
  if (display === undefined) return t("Switched model to {model}", { model: formatRef(model) })
  const variant = model.variant && model.variant !== "default" ? ` (${model.variant})` : ""
  return t("Switched model to {model}", { model: display + variant })
}
