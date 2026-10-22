import { expect, test } from "bun:test"
import { updateNotice, updaterAction } from "./updater"

test("a ready update installs; an idle updater checks", () => {
  expect(updaterAction({ status: "ready", version: "2.0.0" }).run).toBe("install")
  expect(updaterAction({ status: "idle" }).run).toBe("check")
  expect(updaterAction({ status: "downloading", version: "2.0.0" }).run).toBeUndefined()
})

test("the notice shows a ready version or an install in progress", () => {
  expect(updateNotice({ status: "ready", version: "2.0.0" })).toEqual({
    visible: true,
    installing: false,
    version: "2.0.0",
  })
  expect(updateNotice({ status: "installing", version: "2.0.0" }).visible).toBe(true)
  expect(updateNotice({ status: "checking" }).visible).toBe(false)
  expect(updateNotice(undefined).visible).toBe(false)
})
