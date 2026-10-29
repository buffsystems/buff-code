import { intro, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, requireInteractive } from "../../../ui/prompt"
import { t } from "../../../buff/locale"
import { createClient, loadIntegrations, request } from "./shared"
import { chooseCredential, chooseIntegration } from "./account"

export default Runtime.handler(
  Commands.commands.auth.commands.logout,
  Effect.fn("cli.auth.logout")((input) =>
    logout({
      target: Option.getOrUndefined(input.target),
      credential: Option.getOrUndefined(input.credential),
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    }).pipe(handlePromptErrors),
  ),
)

const logout = Effect.fn("cli.auth.logout.run")(function* (input: {
  target?: string
  credential?: string
  server?: string
  standalone: boolean
}) {
  if (!input.target)
    yield* requireInteractive(t("Pass an integration ID or name when running without an interactive terminal"))
  if (!input.credential)
    yield* requireInteractive(t("Pass a credential ID or label when running without an interactive terminal"))
  intro(t("Log out of an account"))
  const client = yield* createClient({ server: input.server, standalone: input.standalone })
  const integrations = yield* loadIntegrations(client)
  const integration = yield* chooseIntegration(integrations, input.target)
  const credentialID = yield* chooseCredential(integration, "log out", input.credential)
  const progress = spinner()
  progress.start(t("Removing credential…"))
  yield* request((signal) => client.credential.remove({ credentialID }, { signal })).pipe(
    Effect.tap(() => Effect.sync(() => progress.stop(t("Removed account from {name}", { name: integration.name })))),
    Effect.tapCause(() => Effect.sync(() => progress.stop(t("Failed to remove credential"), 1))),
  )
  outro(t("Done"))
})
