// Детали сценария (#448): правка описания, «когда применять» и аргументов — тело скрипта не трогается.
import { expect, test } from "bun:test"
import { formOf, metaOf } from "./meta-form"

const meta = {
  name: "review",
  description: "Ревью",
  args: {
    branch: { type: "string" as const, description: "Ветка", required: true },
    rounds: { type: "number" as const, default: 2 },
  },
}

test("the form starts from the saved description and arguments", () => {
  expect(formOf(meta)).toEqual({
    title: "",
    description: "Ревью",
    whenToUse: "",
    args: {
      branch: { description: "Ветка", required: true, default: "" },
      rounds: { description: "", required: false, default: "2" },
    },
  })
})

test("edits become metadata: types stay, defaults read by type, empty — not set", () => {
  const form = formOf(meta)
  expect(
    metaOf(meta, {
      ...form,
      whenToUse: "Перед мержем",
      args: {
        branch: { description: "", required: false, default: "main" },
        rounds: { ...form.args.rounds!, default: "" },
      },
    }),
  ).toEqual({
    meta: {
      name: "review",
      description: "Ревью",
      whenToUse: "Перед мержем",
      args: { branch: { type: "string", default: "main" }, rounds: { type: "number" } },
    },
  })
})

test("a default that does not fit its type is a problem for that field", () => {
  const form = formOf(meta)
  expect(metaOf(meta, { ...form, args: { ...form.args, rounds: { ...form.args.rounds!, default: "два" } } })).toEqual({
    problems: { rounds: "Must be a number." },
  })
})

// #470: название для человека правится в окне и не теряется при правке остального.
test("the title is edited with the rest and kept when untouched", () => {
  const titled = { ...meta, title: "Ревью ветки" }
  expect(formOf(titled).title).toBe("Ревью ветки")
  const kept = metaOf(titled, formOf(titled))
  expect("meta" in kept && kept.meta.title).toBe("Ревью ветки")
  const renamed = metaOf(titled, { ...formOf(titled), title: "  Ревью перед мержем " })
  expect("meta" in renamed && renamed.meta.title).toBe("Ревью перед мержем")
  const cleared = metaOf(titled, { ...formOf(titled), title: " " })
  expect("meta" in cleared && "title" in cleared.meta).toBe(false)
})
