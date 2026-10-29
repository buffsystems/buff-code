import { autocomplete } from "@clack/prompts"
import { Effect } from "effect"
import type { IntegrationInfo } from "@opencode/client"
import { t } from "../../../buff/locale"
import { prompt } from "../../../ui/prompt"
import { resolveIntegration } from "./shared"

export const chooseIntegration = Effect.fn("cli.auth.account.integration")(function* (
  integrations: IntegrationInfo[],
  target?: string,
) {
  if (target) return yield* resolveIntegration(integrations, target)
  const configured = integrations.filter((integration) =>
    integration.connections.some((connection) => connection.type === "credential"),
  )
  if (configured.length === 0) return yield* Effect.fail(new Error(t("No stored credentials found")))
  const id = yield* prompt<string>(() =>
    autocomplete({
      message: t("Select integration"),
      maxItems: 8,
      options: configured.map((integration) => ({
        value: integration.id,
        label: integration.name,
        hint: integration.connections
          .filter((connection) => connection.type === "credential")
          .map((connection) => connection.label)
          .join(", "),
      })),
    }),
  )
  return yield* resolveIntegration(configured, id)
})

export const chooseCredential = Effect.fn("cli.auth.account.credential")(function* (
  integration: IntegrationInfo,
  action: "log out" | "switch to",
  target?: string,
) {
  const credentials = integration.connections.filter((connection) => connection.type === "credential")
  if (credentials.length === 0) {
    const environment = integration.connections
      .filter((connection) => connection.type === "env")
      .map((connection) => connection.name)
    if (environment.length && action === "log out") {
      yield* Effect.fail(
        new Error(
          t("{name} is authenticated through {variables}; unset the environment variable to disconnect", {
            name: integration.name,
            variables: environment.join(", "),
          }),
        ),
      )
    }
    yield* Effect.fail(new Error(t("No stored credentials for {name}", { name: integration.name })))
  }
  if (target) {
    const byID = credentials.find((credential) => credential.id === target)
    if (byID) return byID.id
    const matches = credentials.filter((credential) => credential.label.toLowerCase() === target.toLowerCase())
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1)
      return yield* Effect.fail(
        new Error(
          t("Credential label “{label}” is ambiguous. Use an ID: {ids}", {
            label: target,
            ids: matches.map((item) => item.id).join(", "),
          }),
        ),
      )
    return yield* Effect.fail(
      new Error(t("Credential not found for {name}: {target}", { name: integration.name, target })),
    )
  }
  return yield* prompt<string>(() =>
    autocomplete({
      message:
        action === "log out"
          ? t("Select the {name} account to log out of", { name: integration.name })
          : t("Select the {name} account to switch to", { name: integration.name }),
      maxItems: 8,
      options: credentials.map((credential, index) => ({
        value: credential.id,
        label: index === 0 ? t("{label} (active)", { label: credential.label }) : credential.label,
        hint: credential.id,
      })),
    }),
  )
})
