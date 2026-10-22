import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(Commands.commands.run, (input) =>
  Effect.gen(function* () {
    const { runNonInteractive, reportRunError } = yield* Effect.promise(() => import("../../run/run"))
    const separator = process.argv.indexOf("--", 2)
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    // Buff: без входа или рабочего контекста спросить их здесь же (#401), если команда идёт
    // не на своей модели (#562). Лениво, как и сам run: вопросы консоли не должны попадать
    // в граф run без нужды.
    const { setupBuff } = yield* Effect.promise(() => import("./buff/setup"))
    const setUp = yield* setupBuff(
      OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) }),
      { model: Option.getOrUndefined(input.model) },
    ).pipe(
      Effect.as(true),
      // Отказ настройки — как любая ошибка до сессии: в --format json он тоже JSON.
      Effect.catch((error) =>
        Effect.sync(() => (reportRunError(input, error instanceof Error ? error.message : String(error)), false)),
      ),
    )
    if (!setUp) return
    yield* Effect.promise(() =>
      runNonInteractive({
        server,
        message: [...input.message, ...(separator === -1 ? [] : process.argv.slice(separator + 1))],
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        format: input.format,
        file: [...input.file],
        title: Option.getOrUndefined(input.title),
        thinking: input.thinking,
        auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
      }),
    )
  }),
)
