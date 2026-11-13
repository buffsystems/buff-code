// Журнал мобильного канала (#908): слова шлюза (лимит, отказ в подключении) пишутся логгерами
// службы. Запуск вне её контекста (`Effect.runFork`) терял их — не попадали в журнал службы.
import type { PeerLog } from "@buff/mobile-protocol"
import { Effect } from "effect"

export const peerLog: Effect.Effect<PeerLog> = Effect.gen(function* () {
  const runFork = Effect.runForkWith(yield* Effect.context())
  return {
    info: (message, fields) => void runFork(Effect.logInfo(message, fields ?? {})),
    warn: (message, fields) => void runFork(Effect.logWarning(message, fields ?? {})),
    error: (message, fields) => void runFork(Effect.logError(message, fields ?? {})),
  }
})
