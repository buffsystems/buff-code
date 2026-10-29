import { EOL } from "os"
import { Effect, Option } from "effect"
import { Service } from "@opencode/client/effect/service"
import { OpenCode } from "@opencode/client/promise"
import { renderUnicodeCompact } from "uqr"
import { BuffServerAuth } from "@opencode/schema/buff-server-auth"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServiceConfig } from "../../services/service-config"
import { t } from "../../buff/locale"

export default Runtime.handler(
  Commands.commands.pair,
  Effect.fn("cli.pair")(function* (input: Runtime.Input<typeof Commands.commands.pair>) {
    const endpoint = yield* Service.ensure(yield* ServiceConfig.options())
    const password = yield* ServiceConfig.password()
    const urls = Option.isSome(input.url)
      ? [input.url.value]
      : (yield* Effect.tryPromise(() =>
          OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }).server.info(),
        )).urls
    const info = { urls, username: BuffServerAuth.USERNAME, password }
    // Подписи переводятся, а столбец значений выравнивается по самой длинной из них.
    const labels = { urls: t("URLs"), username: t("Username"), password: t("Password") }
    const width = Math.max(...Object.values(labels).map((label) => label.length)) + 2
    const row = (label: string, value: string) => `  ${label.padEnd(width)}${value}`
    process.stdout.write(
      [
        "",
        row(labels.urls, info.urls[0] ?? t("(none)")),
        ...info.urls.slice(1).map((url) => row("", url)),
        row(labels.username, info.username),
        row(labels.password, info.password),
        "",
        `  ${t("Scan to pair")}`,
        "",
        renderUnicodeCompact(JSON.stringify(info), { border: 2 })
          .split(EOL)
          .map((line) => "  " + line)
          .join(EOL),
        "",
      ].join(EOL) + EOL,
    )

    if (Option.isSome(input.url)) return
    const hostname = new URL(endpoint.url).hostname
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return
    process.stderr.write(
      `  ${t("Run `buff service set hostname 0.0.0.0` to access the service remotely.")}${EOL}${EOL}`,
    )
  }),
)
