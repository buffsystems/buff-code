export * as BuffEnv from "./buff-env.js"

/**
 * Переменные окружения Buff Code под своими именами (#510): BUFF_X — то же, что апстримная
 * OPENCODE_X (BUFF_CONFIG_DIR, BUFF_DISABLE_AUTOUPDATE, BUFF_CONFIG_CONTENT, …). Ядро читает
 * апстримные имена, поэтому при запуске свои переносятся в них; заданы обе — побеждает своя.
 * Апстримные имена по-прежнему работают.
 */

/** Переменные самого Buff Code — у апстрима двойников нет, переносить их некуда. */
const OWN = new Set([
  "BUFF_APP_DIR",
  "BUFF_BINARY",
  "BUFF_CARDS",
  "BUFF_CONNECTOR_URL",
  "BUFF_FRAME",
  "BUFF_HOOK_EVENT",
  "BUFF_HOOK_ID",
  "BUFF_INSTALL_SCRIPT",
  "BUFF_PRODUCT",
  "BUFF_PROVIDER",
  "BUFF_RUNNER",
  "BUFF_UPDATE_API",
])

/** Апстримные двойники своих переменных, которые надо выставить. */
export function aliases(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith("BUFF_") || OWN.has(name)) continue
    out[`OPENCODE_${name.slice("BUFF_".length)}`] = value
  }
  return out
}
