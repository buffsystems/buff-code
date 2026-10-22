import type { FooterView, MiniFormRequest, MiniPermissionRequest } from "./types"
import { t } from "../feature-plugins/buff/locale"

export function pickBlockerView(input: { permission?: MiniPermissionRequest; form?: MiniFormRequest }): FooterView {
  if (input.permission) return { type: "permission", request: input.permission }
  if (input.form) return { type: "form", request: input.form }
  return { type: "prompt" }
}

export function blockerStatus(view: FooterView) {
  if (view.type === "permission") return t("awaiting permission")
  if (view.type === "form") return t("awaiting form")
  return ""
}
