import { t } from "../../../buff/locale"

/**
 * Что сказать, когда после настройки в списке нет моделей Buff (#399, #401): вход и
 * контекст уже есть, значит, коннектор не вернул моделей для организации.
 */
export function buffModelsHint(input: { readonly hasBuffModels: boolean; readonly org: string }): string | undefined {
  if (input.hasBuffModels) return undefined
  return t("The company connector returned no models for the organization {org}.", { org: input.org })
}
