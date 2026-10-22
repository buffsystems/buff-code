// Встроенный git (#495): снимкам нужен git от 2.35; без него человек видит, почему откат не работает.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import { BuffSnapshotGit } from "../src/buff-snapshot-git.js"

const en: BuffI18n.T = (s, p) => BuffI18n.t("en", s, p)
const ru: BuffI18n.T = (s, p) => BuffI18n.t("ru", s, p)

describe("the snapshot warning", () => {
  test("silent while snapshots have their git", () => {
    expect(BuffSnapshotGit.warning({ ready: true, repository: true }, en)).toBeUndefined()
  })
  test("silent outside a git repository — there are no snapshots to lose", () => {
    expect(BuffSnapshotGit.warning({ ready: false, reason: "absent", repository: false }, en)).toBeUndefined()
  })
  test("an old git names its version and the required one", () => {
    const text = BuffSnapshotGit.warning({ ready: false, reason: "old", version: "2.25.1", repository: true }, ru)
    expect(text).toContain("2.25.1")
    expect(text).toContain("2.35")
    expect(text).not.toMatch(/[A-Za-z]{4,}/)
  })
  test("no git at all says to install one", () => {
    const text = BuffSnapshotGit.warning({ ready: false, reason: "absent", repository: true }, en)
    expect(text).toContain("install git 2.35")
  })
})
