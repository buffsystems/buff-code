// Поиск по файлам без сети (#443): ripgrep едет в сборке рядом с бинарём Buff Code.
import { describe, expect, test } from "bun:test"
import { BuffRipgrep } from "../../src/buff/ripgrep"

describe("the bundled ripgrep", () => {
  test("sits next to the running executable under its own name — a user's rg is not overwritten", () => {
    expect(BuffRipgrep.bundledPath("/home/dev/.local/bin/buff", "linux")).toBe("/home/dev/.local/bin/buff-rg")
    expect(BuffRipgrep.bundledName("win32")).toBe("buff-rg.exe")
  })
  test("each build target has its release archive", () => {
    expect(BuffRipgrep.release("x64", "linux")).toEqual({
      platform: "x86_64-unknown-linux-musl",
      extension: "tar.gz",
      filename: "ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz",
      url: "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz",
    })
    expect(BuffRipgrep.release("arm64", "win32")?.extension).toBe("zip")
    expect(BuffRipgrep.release("ppc", "aix")).toBeUndefined()
  })
})

// Выпуск buff.16 (#443): файл суммы ripgrep для Windows/ARM — вывод CertUtil («SHA256 hash of …»
// и хэш на второй строке); первое слово файла — не хэш, сборка падала «контрольная сумма не сошлась».
test("the checksum is read from both sha256sum and CertUtil outputs", () => {
  const hash = "00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e"
  expect(BuffRipgrep.checksum(`${hash}  ripgrep-15.1.0-x86_64-unknown-linux-musl.tar.gz\n`)).toBe(hash)
  expect(
    BuffRipgrep.checksum(
      `SHA256 hash of ripgrep-15.1.0-aarch64-pc-windows-msvc.zip:\n${hash}\nCertUtil: -hashfile command completed successfully.\n`,
    ),
  ).toBe(hash)
  expect(BuffRipgrep.checksum("not a checksum")).toBeUndefined()
})
