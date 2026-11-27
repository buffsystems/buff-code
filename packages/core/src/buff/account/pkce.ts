export * as BuffAccountPkce from "./pkce.js"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Вход в личный аккаунт Buff (#966): код авторизации с PKCE (RFC 7636, S256) через страницу
 * веб-клиента. Здесь — всё, что считается без сети: проверочная строка и её отпечаток, state,
 * адрес страницы и разбор того, чем страница возвращает код — переходом на 127.0.0.1 или
 * строкой `код#state`, которую человек вставляет руками. Сервер не видит ни state, ни способа
 * возврата: это между Buff Code и страницей.
 */

/** Сайт аккаунта, если его не назвали: buff.systems. */
export const DEFAULT_HOST = "buff.systems"
/** Свои переменные: сайт аккаунта (шлюз команд) и адрес веб-клиента со страницей входа. */
export const HOST_ENV = "BUFF_ACCOUNT_HOST"
export const WEB_ENV = "BUFF_ACCOUNT_WEB"

type Env = Readonly<Record<string, string | undefined>>

/** Сайт аккаунта: к нему идут команды (`wss://<host>/nats`). */
export function host(env: Env): string {
  return env[HOST_ENV]?.trim() || DEFAULT_HOST
}

/** Адрес веб-клиента: названный в окружении, иначе `code.<сайт аккаунта>`. */
export function webOrigin(env: Env): string {
  const named = env[WEB_ENV]?.trim()
  if (!named) return `https://code.${host(env)}`
  return new URL(named.includes("://") ? named : `https://${named}`).origin
}

/** Проверочная строка: 43 знака из набора RFC 7636. Из Buff Code она не уходит до обмена кода. */
export const verifier = (): string => randomBytes(32).toString("base64url")

/** Отпечаток проверочной строки (S256) — ровно 43 знака. */
export const challenge = (value: string): string => createHash("sha256").update(value, "ascii").digest("base64url")

/** state: 256 случайных бит. По нему Buff Code узнаёт свой ответ и не берёт чужой код. */
export const state = (): string => randomBytes(32).toString("base64url")

export type Return = { readonly type: "loopback"; readonly port: number } | { readonly type: "paste" }

export interface Request {
  readonly origin: string
  readonly challenge: string
  readonly state: string
  /** Как устройство увидит человек на странице. */
  readonly device: string
  readonly pubkey: string
  readonly return: Return
}

/** Адрес страницы, где человек разрешает вход. */
export function authorizeURL(input: Request): string {
  const url = new URL("/authorize", input.origin)
  url.searchParams.set("challenge", input.challenge)
  url.searchParams.set("state", input.state)
  url.searchParams.set("device", input.device)
  url.searchParams.set("pubkey", input.pubkey)
  url.searchParams.set("return", input.return.type)
  if (input.return.type === "loopback") url.searchParams.set("port", String(input.return.port))
  return url.href
}

/** Чем кончился возврат: код, отказ человека или чужой запрос, на который не отвечают входом. */
export type Returned =
  | { readonly type: "code"; readonly code: string }
  | { readonly type: "denied" }
  | { readonly type: "stranger"; readonly reason: "path" | "state" | "empty" }

/** Сравнение без утечки по времени: чужой не подберёт state по задержке ответа. */
export function same(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Запрос, пришедший на 127.0.0.1: принимается только `GET /callback` со своим state. */
export function callback(method: string | undefined, target: string | undefined, expected: string): Returned {
  const url = new URL(target ?? "/", "http://127.0.0.1")
  if (method !== "GET" || url.pathname !== "/callback") return { type: "stranger", reason: "path" }
  if (!same(url.searchParams.get("state") ?? "", expected)) return { type: "stranger", reason: "state" }
  if (url.searchParams.get("error")) return { type: "denied" }
  const code = url.searchParams.get("code")
  return code ? { type: "code", code } : { type: "stranger", reason: "empty" }
}

/** Строка со страницы `код#state`: делится по ПОСЛЕДНЕЙ решётке, state должен быть своим. */
export function pasted(text: string, expected: string): Returned {
  const value = text.trim()
  const at = value.lastIndexOf("#")
  if (at <= 0) return { type: "stranger", reason: "empty" }
  if (!same(value.slice(at + 1), expected)) return { type: "stranger", reason: "state" }
  return { type: "code", code: value.slice(0, at) }
}

/** Похоже, что браузер на этом компьютере не открыть: SSH, WSL или Linux без графики. */
export function headless(env: Env, platform: string, release = ""): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT) return true
  if (platform !== "linux") return false
  if (env.WSL_DISTRO_NAME || /microsoft/i.test(release)) return true
  return !env.DISPLAY && !env.WAYLAND_DISPLAY
}
