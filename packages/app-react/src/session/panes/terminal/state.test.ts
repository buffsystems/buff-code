import { describe, expect, test } from "bun:test"
import {
  addTerminal,
  closeTerminal,
  cycleTerminal,
  decodeTerminals,
  moveTerminal,
  nextTerminalNumber,
  removeExited,
  replaceTerminal,
  trimTerminal,
  updateTerminal,
  type LocalPTY,
  type TerminalState,
} from "./state"

const pty = (id: string, titleNumber: number, title = `Terminal ${titleNumber}`): LocalPTY => ({
  id,
  title,
  titleNumber,
})
const three: TerminalState = { active: "b", all: [pty("a", 1), pty("b", 2), pty("c", 3)] }

describe("decodeTerminals", () => {
  test("drops duplicates, recovers numbers from titles and keeps a known active terminal", () => {
    const raw = JSON.stringify({
      active: "x",
      all: [{ id: "a", title: "Терминал 3" }, { id: "a", title: "dup" }, { id: "b", title: "shell", titleNumber: 2 }],
    })
    expect(decodeTerminals(raw)).toEqual({
      active: "a",
      all: [
        { id: "a", title: "Терминал 3", titleNumber: 3, rows: undefined, cols: undefined, buffer: undefined, scrollY: undefined, cursor: undefined },
        { id: "b", title: "shell", titleNumber: 2, rows: undefined, cols: undefined, buffer: undefined, scrollY: undefined, cursor: undefined },
      ],
    })
    expect(decodeTerminals("[]")).toBeUndefined()
  })
})

test("nextTerminalNumber fills the first gap", () => {
  expect(nextTerminalNumber([])).toBe(1)
  expect(nextTerminalNumber([pty("a", 1), pty("c", 3)])).toBe(2)
  expect(nextTerminalNumber([pty("a", 0, "Terminal 1"), pty("b", 2)])).toBe(3)
})

describe("closing", () => {
  test("a closed active terminal hands over to the one before it", () => {
    expect(closeTerminal(three, "b")).toEqual({ active: "a", all: [pty("a", 1), pty("c", 3)] })
    expect(closeTerminal({ ...three, active: "a" }, "a").active).toBe("b")
    expect(closeTerminal(three, "c").active).toBe("b")
  })

  test("an exited active terminal hands over to the first remaining", () => {
    expect(removeExited({ ...three, active: "c" }, "c").active).toBe("a")
    expect(removeExited({ ...three, active: "a" }, "a").active).toBe("b")
    expect(removeExited(three, "x")).toBe(three)
  })
})

test("add, move, cycle and update", () => {
  const added = addTerminal(three, pty("d", 4))
  expect(added.active).toBe("d")
  expect(moveTerminal(added, "d", 0).all.map((item) => item.id)).toEqual(["d", "a", "b", "c"])
  expect(cycleTerminal(three, 1).active).toBe("c")
  expect(cycleTerminal({ ...three, active: "a" }, -1).active).toBe("c")
  expect(updateTerminal(three, { id: "b", title: "build" }).all[1]?.title).toBe("build")
})

test("trim drops the restored screen and replace keeps the place and number", () => {
  const restored = { ...pty("a", 1), buffer: "x", cursor: 4, scrollY: 2, rows: 10, cols: 80 }
  expect(trimTerminal(restored)).toEqual({ ...pty("a", 1), buffer: undefined, cursor: undefined, scrollY: undefined, rows: 10, cols: 80 })
  const plain = pty("a", 1)
  expect(trimTerminal(plain)).toBe(plain)
  expect(replaceTerminal(three, "b", { id: "z" })).toEqual({ active: "z", all: [pty("a", 1), pty("z", 2), pty("c", 3)] })
})
