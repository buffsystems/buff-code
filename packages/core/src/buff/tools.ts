export * as BuffTools from "./tools.js"

import { Duration, Effect, Schedule, Stream } from "effect"
import type { Scope } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { BuffContext } from "@opencode/schema/buff-context"
import { BuffLocale } from "./locale.js"
import { BuffModels } from "./models.js"

/**
 * Инструменты пространства в Buff Code (#368). Коннектор компании отдаёт подключённые
 * интеграции и MCP администратора по опубликованному MCP на своём шлюзе (`/v1/mcp`), ключ —
 * токен разработчика. После входа сервер «buff» прописан сам (#401): адрес — из входа,
 * токен — свежий. Токен живёт минуты, поэтому заголовок обновляется при каждом обновлении
 * входа и по таймеру, раньше, чем старый истечёт.
 *
 * База знаний организации (#371) — отдельный сервер «knowledge» на том же шлюзе
 * (`/v1/knowledge/mcp`): модель видит инструменты под теми же именами, что и в прогонах
 * пайплайна (`knowledge_read_entry`, …). Рабочий контекст (#391) едет заголовками: по нему
 * бэкенд выбирает записи, а смена контекста перечитывает знания. Репозитории проекта (#372) —
 * так же, свой сервер «repos» (`/v1/repos/mcp`), только чтение.
 *
 * Язык человека (#565) едет заголовком `X-Buff-Lang` к каждому серверу шлюза: коннектор
 * описывает инструменты, отвечает и отказывает на нём (старый коннектор заголовка не знает и
 * говорит на своём). Смена языка доходит со следующей перепроверкой.
 */

export const serverName = "buff"
export const knowledgeServerName = "knowledge"
export const reposServerName = "repos"
/** Обновление входа — за 5 минут до истечения токена; перечитываем чаще. */
const RECHECK = Duration.minutes(4)

/** Заголовок языка человека для шлюза коннектора (#565). */
export const LANG_HEADER = "X-Buff-Lang"

export function serverConfig(me: BuffModels.SignedIn | undefined, lang: string = BuffLocale.current()) {
  if (!me) return undefined
  return {
    type: "remote" as const,
    url: `${me.connector}/v1/mcp`,
    headers: { Authorization: `Bearer ${me.token}`, [LANG_HEADER]: lang },
    // Вход — наш, через коннектор; чужой OAuth серверу не нужен.
    oauth: false as const,
  }
}

/** Заголовки знаний: рабочий контекст целиком — организация, проект, пространства. */
export function knowledgeHeaders(choice: BuffContext.Choice | null): Record<string, string> {
  return {
    ...BuffModels.contextHeaders(choice),
    ...(choice?.spaces.length ? { "X-Buff-Spaces": choice.spaces.join(",") } : {}),
  }
}

/** Сервер шлюза, который отвечает по рабочему контексту: токен и контекст — в заголовках. */
function contextServerConfig(
  me: BuffModels.SignedIn | undefined,
  choice: BuffContext.Choice | null,
  path: string,
  lang: string,
) {
  if (!me) return undefined
  return {
    type: "remote" as const,
    url: `${me.connector}${path}`,
    headers: { Authorization: `Bearer ${me.token}`, [LANG_HEADER]: lang, ...knowledgeHeaders(choice) } as Record<
      string,
      string
    >,
    oauth: false as const,
    // Native tools, not Code Mode (opencode v2's default for MCP): the model calls them by the
    // names the instructions use — knowledge_read_entry & co. as a pipeline run, repos_grep & co.
    codemode: false as const,
  }
}

export function knowledgeConfig(
  me: BuffModels.SignedIn | undefined,
  choice: BuffContext.Choice | null,
  lang: string = BuffLocale.current(),
) {
  return contextServerConfig(me, choice, "/v1/knowledge/mcp", lang)
}

/** Репозитории проекта (#372): только чтение, рядом со своими glob/grep/read рабочего каталога. */
export function reposConfig(
  me: BuffModels.SignedIn | undefined,
  choice: BuffContext.Choice | null,
  lang: string = BuffLocale.current(),
) {
  return contextServerConfig(me, choice, "/v1/repos/mcp", lang)
}

/** Регистрирует серверы шлюза; возвращает перепроверку — её зовут и при смене контекста. */
export const register = Effect.fn("BuffTools.register")(function* (
  ctx: Context,
  signedIn: Effect.Effect<BuffModels.SignedIn | undefined>,
  choice: Effect.Effect<BuffContext.Choice | null>,
) {
  let current: BuffModels.SignedIn | undefined
  let context: BuffContext.Choice | null = null
  let lang = BuffLocale.current()

  yield* ctx.mcp.transform((editor) => {
    const config = serverConfig(current, lang)
    if (config) editor.set(serverName, config)
    else editor.remove(serverName)
    for (const [name, config] of [
      [knowledgeServerName, knowledgeConfig(current, context, lang)],
      [reposServerName, reposConfig(current, context, lang)],
    ] as const) {
      if (config) editor.set(name, config)
      else editor.remove(name)
    }
  })

  const recheck = Effect.gen(function* () {
    const next = yield* signedIn
    const nextContext = yield* choice
    const nextLang = BuffLocale.current()
    if (
      next?.connector === current?.connector &&
      next?.token === current?.token &&
      nextLang === lang &&
      JSON.stringify(nextContext) === JSON.stringify(context)
    )
      return
    current = next
    context = nextContext
    lang = nextLang
    yield* ctx.mcp.reload()
  }).pipe(Effect.catch((cause) => Effect.logWarning("Buff: the space tools are unavailable", { cause })))

  yield* ctx.event.subscribe().pipe(
    Stream.filter(
      (event) =>
        (event.type === "credential.switched" || event.type === "credential.updated") &&
        (event.data as { integrationID?: string } | undefined)?.integrationID === "buff",
    ),
    Stream.runForEach(() => recheck),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* recheck.pipe(Effect.repeat(Schedule.spaced(RECHECK)), Effect.forkScoped)
  return recheck
}) satisfies (...args: never[]) => Effect.Effect<Effect.Effect<void>, never, Scope.Scope>
