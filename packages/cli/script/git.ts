import { $ } from "bun"
import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

// Buff (#495): встроенный git — каталог `buff-git/` рядом с бинарём. Снимки сессии требуют
// git от 2.35, а на Windows git может не быть вовсе. Linux — статический git, собранный
// `buff/git/build-static.sh`; Windows — официальный MinGit; macOS — без встроенного (git от Apple).
const MINGIT_VERSION = "2.56.0.2"
const MINGIT_TAG = "v2.56.0.windows.2"
const MINGIT = {
  x64: {
    file: `MinGit-${MINGIT_VERSION}-64-bit.zip`,
    sha256: "da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be",
  },
  arm64: {
    file: `MinGit-${MINGIT_VERSION}-arm64.zip`,
    sha256: "38b33dc6024026e3315cf88ab2cfea65205bbd7bb3a8e824bd21c8ad4fe609a7",
  },
} as const

const root = path.resolve(import.meta.dirname, "..", "..", "..")
const cache = path.resolve(import.meta.dirname, "..", ".cache", "git")

async function mingit(arch: keyof typeof MINGIT) {
  const release = MINGIT[arch]
  const file = path.join(cache, release.file)
  if (await Bun.file(file).exists()) return file
  await mkdir(cache, { recursive: true })
  const url = `https://github.com/git-for-windows/git/releases/download/${MINGIT_TAG}/${release.file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`git: ${url} — ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash("sha256").update(bytes).digest("hex") !== release.sha256)
    throw new Error(`git: контрольная сумма ${release.file} не сошлась`)
  await Bun.write(file, bytes)
  return file
}

export async function bundleGit(target: { os: string; arch: "arm64" | "x64" }, bin: string) {
  const destination = path.join(bin, "buff-git")
  await rm(destination, { recursive: true, force: true })
  if (target.os === "linux")
    return void (await $`bash ${path.join(root, "buff", "git", "build-static.sh")} ${target.arch} ${destination}`)
  if (target.os === "win32") return void (await $`unzip -oq ${await mingit(target.arch)} -d ${destination}`)
}
