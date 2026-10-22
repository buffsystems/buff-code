import http from "node:http"
import { readFileSync } from "node:fs"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { app, dialog, safeStorage, session } from "electron"
import { getStore } from "../storage/store"
import { BuffNetwork } from "./network"
import { buffNativeText } from "../native/translations"

/**
 * Где лежат настройки сети (#461) и как они применяются при запуске. Адрес, исключения, путь к
 * сертификату и логин — в хранилище настроек приложения; пароль — зашифрованным средствами
 * системы (без них пароль не сохраняется). Применение — после готовности Electron и до запуска
 * службы: она получает их переменными окружения.
 */

const KEY = "buff.network"
const LOOPBACK = ["127.0.0.1", "localhost", "::1"]

interface Stored extends BuffNetwork.Settings {
  readonly password?: string
}

export interface View extends BuffNetwork.Settings {
  readonly hasPassword: boolean
  readonly canEncrypt: boolean
}

function stored(): Stored {
  const value = getStore().get(KEY) as Partial<Stored> | undefined
  return {
    proxy: typeof value?.proxy === "string" ? value.proxy : "",
    noProxy: typeof value?.noProxy === "string" ? value.noProxy : "",
    caFile: typeof value?.caFile === "string" ? value.caFile : "",
    username: typeof value?.username === "string" ? value.username : "",
    ...(typeof value?.password === "string" ? { password: value.password } : {}),
  }
}

function password(value: Stored): string | undefined {
  if (!value.password || !safeStorage.isEncryptionAvailable()) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(value.password, "base64"))
  } catch {
    return undefined
  }
}

export function get(): View {
  const { password: secret, ...settings } = stored()
  return { ...settings, hasPassword: !!secret, canEncrypt: safeStorage.isEncryptionAvailable() }
}

/** Сохранить; `password`: строка — новый, "" — убрать, undefined — оставить прежний. */
export function set(next: BuffNetwork.Settings & { password?: string }): string | undefined {
  const problem = BuffNetwork.proxyProblem(next.proxy)
  if (problem) return problem
  const before = stored()
  let secret = before.password
  if (next.password === "") secret = undefined
  // Без хранилища ключей пароль не сохраняется вовсе — остальное сохраняется (окно об этом говорит).
  else if (next.password && safeStorage.isEncryptionAvailable())
    secret = safeStorage.encryptString(next.password).toString("base64")
  getStore().set(KEY, {
    proxy: next.proxy.trim(),
    noProxy: next.noProxy,
    caFile: next.caFile.trim(),
    username: next.username.trim(),
    ...(secret ? { password: secret } : {}),
  })
  return undefined
}

export async function pickCertificate(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: buffNativeText("Organization certificate"),
    filters: [{ name: buffNativeText("Certificate"), extensions: ["pem", "crt", "cer"] }],
  })
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/** Применить при запуске: переменные для службы, прокси окна, вход в прокси, свой сертификат. */
export function apply(): void {
  const settings = stored()
  const secret = password(settings)
  const env = BuffNetwork.environment(settings, secret)
  if (Object.keys(env).length === 0) return
  // Своя служба на этой машине через прокси не ходит никогда.
  const bypass = [...new Set([...(env.NO_PROXY ?? process.env.NO_PROXY ?? "").split(","), ...LOOPBACK])]
    .filter(Boolean)
    .join(",")
  Object.assign(process.env, env, { NO_PROXY: bypass, no_proxy: bypass })
  const proxyAwareHttp = http as typeof http & { setGlobalProxyFromEnv?(): void }
  proxyAwareHttp.setGlobalProxyFromEnv?.()
  if (settings.proxy) {
    void session.defaultSession.setProxy({
      proxyRules: BuffNetwork.chromiumRule(settings.proxy),
      proxyBypassRules: `<-loopback>,${bypass}`,
    })
    app.on("login", (event, _contents, _details, auth, callback) => {
      if (!auth.isProxy || !settings.username) return
      event.preventDefault()
      callback(settings.username, secret ?? "")
    })
  }
  if (settings.caFile) {
    try {
      const own = readFileSync(settings.caFile, "utf8")
      setDefaultCACertificates([...getCACertificates("default"), ...getCACertificates("system"), own])
    } catch {
      // Сертификат не прочитался — служба всё равно получит путь; окно скажет об ошибке соединения.
    }
  }
}
