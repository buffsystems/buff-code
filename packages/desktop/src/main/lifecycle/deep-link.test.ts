import { expect, test } from "bun:test"
import { DEEP_LINK_SCHEME, deepLinkArgs } from "./deep-link"

test("the app claims its own scheme, the one the packages declare", () => {
  expect(DEEP_LINK_SCHEME).toBe("buff")
})

test("a second instance hands over only buff:// links", () => {
  expect(deepLinkArgs(["/opt/Buff Code/buff-code", "--flag", "buff://open?x=1", "opencode://open"])).toEqual([
    "buff://open?x=1",
  ])
})
