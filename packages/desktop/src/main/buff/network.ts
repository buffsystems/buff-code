export * as BuffNetwork from "./network"

/**
 * Прокси, исключения и свой сертификат из настроек (#461). Действуют на всё приложение: окно,
 * службу (коннектор компании, модели, MCP) и обновления — служба получает их переменными
 * окружения при запуске, поэтому новые настройки применяются после перезапуска. Пустые поля —
 * как раньше: прокси из системы. Пароль хранится зашифрованным средствами системы.
 */

export interface Settings {
  readonly proxy: string
  readonly noProxy: string
  readonly caFile: string
  readonly username: string
}

/** Что не так с адресом прокси; пустой — можно (прокси из системы). По-английски — окно переводит. */
export function proxyProblem(proxy: string): string | undefined {
  const value = proxy.trim()
  if (!value) return undefined
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
    return "The proxy address starts with http:// or https://, for example http://proxy.company.local:3128."
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return "The proxy address starts with http:// or https://, for example http://proxy.company.local:3128."
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return "An HTTP proxy is supported: an address with http:// or https://."
  if (url.username || url.password) return "The login and password go in separate fields, not in the address."
  if (!url.hostname)
    return "The proxy address starts with http:// or https://, for example http://proxy.company.local:3128."
  return undefined
}

function exceptions(noProxy: string): string {
  return noProxy
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",")
}

/** Переменные окружения для службы и главного процесса; пустые настройки — ничего. */
export function environment(settings: Settings, password: string | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  if (settings.proxy.trim() && !proxyProblem(settings.proxy)) {
    const url = new URL(settings.proxy.trim())
    if (settings.username) {
      url.username = encodeURIComponent(settings.username)
      if (password) url.password = encodeURIComponent(password)
    }
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) env[key] = url.href
  }
  const bypass = exceptions(settings.noProxy)
  if (bypass) {
    env.NO_PROXY = bypass
    env.no_proxy = bypass
  }
  if (settings.caFile.trim()) env.NODE_EXTRA_CA_CERTS = settings.caFile.trim()
  return env
}

/** Правило прокси для окна (Chromium): узел и порт, без логина — его спрашивает окно отдельно. */
export function chromiumRule(proxy: string): string {
  const url = new URL(proxy.trim())
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  const target = `${url.hostname}:${port}`
  return `http=${target};https=${target}`
}
