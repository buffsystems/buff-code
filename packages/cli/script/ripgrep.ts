import { $ } from "bun"
import { createHash } from "node:crypto"
import { copyFile, chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { BuffRipgrep } from "../../core/src/buff/ripgrep"

// Buff: ripgrep нужной цели кладётся рядом с бинарём — поиск по файлам работает без сети.
// Архив качается один раз в кэш пакета и сверяется с контрольной суммой выпуска ripgrep.
const cache = path.resolve(import.meta.dirname, "..", ".cache", "ripgrep", BuffRipgrep.VERSION)

async function download(url: string, file: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`ripgrep: ${url} — ${response.status}`)
  await Bun.write(file, await response.arrayBuffer())
}

async function archive(release: NonNullable<ReturnType<typeof BuffRipgrep.release>>) {
  const file = path.join(cache, release.filename)
  if (!(await Bun.file(file).exists())) {
    await mkdir(cache, { recursive: true })
    await download(`${release.url}.sha256`, `${file}.sha256`)
    await download(release.url, `${file}.part`)
    const expected = BuffRipgrep.checksum(await Bun.file(`${file}.sha256`).text())
    const actual = createHash("sha256")
      .update(new Uint8Array(await Bun.file(`${file}.part`).arrayBuffer()))
      .digest("hex")
    if (actual !== expected) throw new Error(`ripgrep: контрольная сумма ${release.filename} не сошлась`)
    await $`mv ${file}.part ${file}`
  }
  return file
}

export async function bundleRipgrep(target: { os: string; arch: string }, bin: string) {
  const release = BuffRipgrep.release(target.arch, target.os)
  if (!release) throw new Error(`ripgrep: нет выпуска для ${target.arch}-${target.os}`)
  const source = await archive(release)
  const temporary = await mkdtemp(path.join(cache, "unpack-"))
  try {
    await (release.extension === "zip" ? $`unzip -oq ${source} -d ${temporary}` : $`tar -xzf ${source} -C ${temporary}`)
    const name = target.os === "win32" ? "rg.exe" : "rg"
    const destination = path.join(bin, BuffRipgrep.bundledName(target.os))
    await copyFile(path.join(temporary, `ripgrep-${BuffRipgrep.VERSION}-${release.platform}`, name), destination)
    if (target.os !== "win32") await chmod(destination, 0o755)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
