import { expect, test } from "bun:test"
import { avatarColors } from "@buff/ui/react"
import { projectColor } from "./project-icon"

test("a stored colour key is one of the project palette's colours", () => {
  expect(avatarColors.map((color) => projectColor(color))).toEqual([...avatarColors])
})

test("older keys map to their successors and unknown keys to none", () => {
  expect(projectColor("mint")).toBe("cyan")
  expect(projectColor("lime")).toBe("green")
  expect(projectColor("teal")).toBeUndefined()
  expect(projectColor(undefined)).toBeUndefined()
})
