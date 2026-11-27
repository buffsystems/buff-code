export * as BuffProviderFetch from "./provider-fetch.js"

import { Effect } from "effect"
import { HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

/**
 * Провайдер, до которого не дойти по HTTP (#966). Слой моделей говорит с провайдером запросами
 * HTTP, а модели подписки аккаунта Buff зовутся командой через другое соединение. Такой
 * провайдер отвечает на запрос сам: называет здесь свой `fetch`, и запрос к его моделям — из
 * сессии или разовый (текст коммита) — по сети не уходит, а отдаётся ему.
 */

export type Fetch = (request: Request, signal: AbortSignal) => Promise<Response>

// На провайдера может быть несколько ответчиков — по одному на открытый каталог; годится любой живой.
const registry = new Map<string, Set<Fetch>>()

/** Назвать ответчика провайдера; возвращает снятие — его зовут, когда каталог закрывается. */
export function register(providerID: string, fetch: Fetch): () => void {
  const set = registry.get(providerID) ?? new Set<Fetch>()
  registry.set(providerID, set.add(fetch))
  return () => {
    set.delete(fetch)
    if (set.size === 0 && registry.get(providerID) === set) registry.delete(providerID)
  }
}

/** Ответчик провайдера, если он есть: последний названный. */
export function get(providerID: string): Fetch | undefined {
  return Array.from(registry.get(providerID) ?? []).at(-1)
}

/** Ответить на запрос слоя моделей ответчиком провайдера — вместо сети. */
export const answer = (fetch: Fetch, request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    const web = yield* HttpClientRequest.toWeb(request)
    return HttpClientResponse.fromWeb(request, yield* Effect.promise((signal) => fetch(web, signal)))
  }).pipe(Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))))
