// Подпись и нотаризация macOS-сборки на Linux (autonomous-dev/cloud-front#764). electron-builder на
// Linux подпись пропускает, поэтому бандл подписывает rcodesign. С ключами из окружения — сертификатом
// Developer ID с hardened runtime и нотаризацией Apple (Gatekeeper пускает без предупреждения); без
// них — ad-hoc, как раньше (без подписи вовсе приложение на Apple Silicon не запускается).
// Ключи передаются по имени и на время подписи лежат во временном каталоге, который потом стирается:
//   BUFF_MAC_SIGN_P12        сертификат Developer ID Application с закрытым ключом (.p12, base64)
//   BUFF_MAC_SIGN_PASSWORD   пароль .p12
//   BUFF_MAC_NOTARY_ISSUER, BUFF_MAC_NOTARY_KEY_ID, BUFF_MAC_NOTARY_KEY — ключ App Store Connect API (.p8)
import { execFile } from "node:child_process"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const NAMES = {
  p12: "BUFF_MAC_SIGN_P12",
  password: "BUFF_MAC_SIGN_PASSWORD",
  issuer: "BUFF_MAC_NOTARY_ISSUER",
  keyId: "BUFF_MAC_NOTARY_KEY_ID",
  key: "BUFF_MAC_NOTARY_KEY",
} as const

export type MacSigning = Record<keyof typeof NAMES, string>

/** Ключи подписи из окружения; нет ни одного — null (ad-hoc). Часть — отказ: подпись без нотаризации не пройдёт Gatekeeper. */
export function macSigning(env: Record<string, string | undefined>): MacSigning | null {
  const entries = Object.entries(NAMES) as [keyof typeof NAMES, string][]
  const missing = entries.filter(([, name]) => !env[name]).map(([, name]) => name)
  if (missing.length === entries.length) return null
  if (missing.length) throw new Error(`подпись macOS: заданы не все ключи, нет ${missing.join(", ")}`)
  return Object.fromEntries(entries.map(([k, name]) => [k, env[name]!])) as MacSigning
}

/** Файлы ключей во временном каталоге. */
export interface MacKeyFiles {
  p12: string
  passwordFile: string
  notaryJson: string
}

/**
 * Подпись бандла одним вызовом: rcodesign проходит вложенные бандлы и Mach-O сам, а права
 * (entitlements) задаются по местам — приложению и помощникам Electron свои (JIT), вложенной
 * консоли свои (bun-pty грузит свою библиотеку). Остальное наследует сертификат и метку времени.
 */
export function signArgs(
  bundle: string,
  keys: MacKeyFiles,
  plists: { app: string; cli: string },
  helpers: readonly string[],
): string[] {
  return [
    "sign",
    "--for-notarization",
    "--p12-file",
    keys.p12,
    "--p12-password-file",
    keys.passwordFile,
    "--entitlements-xml-file",
    plists.app,
    ...helpers.flatMap((h) => ["--entitlements-xml-file", `${h}:${plists.app}`]),
    "--entitlements-xml-file",
    `Contents/Resources/buff:${plists.cli}`,
    bundle,
  ]
}

/** Нотаризация: отправить, дождаться ответа Apple и поставить печать на бандл (тогда он проходит и без сети). */
export function notarizeArgs(bundle: string, keys: MacKeyFiles): string[] {
  return ["notary-submit", "--api-key-file", keys.notaryJson, "--staple", "--max-wait-seconds", "3600", bundle]
}

/** Помощники Electron — вложенные .app в Contents/Frameworks, путями относительно бандла. */
async function helperApps(bundle: string): Promise<string[]> {
  const frameworks = path.join(bundle, "Contents/Frameworks")
  return (await readdir(frameworks)).filter((n) => n.endsWith(".app")).map((n) => `Contents/Frameworks/${n}`)
}

/** Подписать бандл Developer ID и нотаризовать; ключи — во временном каталоге, стираются и при ошибке. */
export async function signAndNotarize(
  bundle: string,
  s: MacSigning,
  plists: { app: string; cli: string },
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "buff-mac-sign-"))
  try {
    const keys: MacKeyFiles = {
      p12: path.join(dir, "cert.p12"),
      passwordFile: path.join(dir, "pw"),
      notaryJson: path.join(dir, "notary.json"),
    }
    const p8 = path.join(dir, `AuthKey_${s.keyId}.p8`)
    await writeFile(keys.p12, Buffer.from(s.p12, "base64"), { mode: 0o600 })
    await writeFile(keys.passwordFile, s.password, { mode: 0o600 })
    await writeFile(p8, s.key, { mode: 0o600 })
    await execFileAsync("rcodesign", ["encode-app-store-connect-api-key", "-o", keys.notaryJson, s.issuer, s.keyId, p8])
    await execFileAsync("rcodesign", signArgs(bundle, keys, plists, await helperApps(bundle)), { maxBuffer: 64 << 20 })
    const { stdout, stderr } = await execFileAsync("rcodesign", notarizeArgs(bundle, keys), { maxBuffer: 64 << 20 })
    console.log(`${stdout}${stderr}`.trim().split("\n").slice(-5).join("\n"))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
