export * as BuffRipgrep from "./ripgrep.js"

import path from "path"

/**
 * ripgrep в сборке Buff Code. Без него не работают поиск и обзор файлов, а скачать его с
 * GitHub при первом поиске в сети компании часто нельзя. Поэтому сборка кладёт его рядом с
 * бинарём (консоль, архив выпуска, ресурсы десктопа), а ядро ищет его там. Имя своё — чтобы
 * установка в общий каталог программ не затёрла `rg`, который человек поставил сам.
 */

export const VERSION = "15.1.0"
export const PLATFORM = {
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
  "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
  "ia32-win32": { platform: "i686-pc-windows-msvc", extension: "zip" },
  "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
} as const

export function bundledName(platform: string): string {
  return platform === "win32" ? "buff-rg.exe" : "buff-rg"
}

export function bundledPath(execPath: string, platform: string): string {
  return path.join(path.dirname(execPath), bundledName(platform))
}

/** Архив выпуска ripgrep для цели сборки; `undefined` — цель ripgrep не поддерживает. */
export function release(arch: string, os: string) {
  const config = PLATFORM[`${arch}-${os}` as keyof typeof PLATFORM]
  if (!config) return undefined
  const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
  return { ...config, filename, url: `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}` }
}

/** Хэш из файла суммы выпуска: и вывод sha256sum («хэш  имя»), и вывод CertUtil (хэш второй строкой). */
export function checksum(text: string): string | undefined {
  return text.match(/\b[0-9a-f]{64}\b/i)?.[0]?.toLowerCase()
}
