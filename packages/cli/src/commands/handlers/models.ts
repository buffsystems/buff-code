import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { buffModelsHint } from "./buff/models-hint"
import { setupBuff } from "./buff/setup"

export default Runtime.handler(
  Commands.commands.models,
  Effect.fn("cli.models")(function* (input) {
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({
      baseUrl: server.endpoint.url,
      headers: Service.headers(server.endpoint),
    })
    // Buff: вход и рабочий контекст спрашиваются здесь же, если их нет (#401); rpc ждёт
    // загрузки плагинов, а с ней — моделей организации (#399).
    const choice = yield* setupBuff(client)
    const response = yield* Effect.promise(() => client.model.list({ location: { directory: process.cwd() } }))
    const models = response.data
      .map((model) => `${model.providerID}/${model.id}`)
      .toSorted((a, b) => a.localeCompare(b))
    if (models.length > 0) process.stdout.write(models.join(EOL) + EOL)
    const hint = choice && buffModelsHint({ hasBuffModels: models.some((model) => model.startsWith("buff/")), org: choice.org })
    if (hint) process.stderr.write(hint + EOL)
  }),
)
