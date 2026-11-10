// Форма режима «Настройка» (#765): поля из слов модели, ответы — модели, секрет — ссылкой.
import { describe, expect, test } from "bun:test"
import { BuffSetupFormPlugin } from "../../src/buff/setup-form"

const input = {
  title: "Почта",
  note: "Нужно, чтобы читать письма",
  fields: [
    {
      key: "host",
      label: "Адрес сервера",
      hint: "Из настроек",
      kind: "text",
      required: true,
      placeholder: "mail.example.com",
    },
    { key: "password", label: "Пароль", kind: "secret", required: true },
    {
      key: "folder",
      label: "Папка",
      kind: "choice",
      required: false,
      options: [{ value: "inbox", label: "Входящие" }],
    },
    {
      key: "folders",
      label: "Какие папки",
      kind: "multi",
      required: false,
      options: [
        { value: "inbox", label: "Входящие" },
        { value: "sent", label: "Отправленные" },
      ],
      custom: true,
    },
    { key: "ssl", label: "Защищённое соединение", kind: "yesno", required: true },
    { key: "port", label: "Порт", kind: "number", required: false },
    { key: "allow", label: "Разрешить доступ", kind: "link", required: true, url: "https://x.example/allow" },
  ],
} as const

describe("fields from the model's description", () => {
  test("each kind maps to a form field; the secret kind is a secret field", () => {
    const built = BuffSetupFormPlugin.fields(input)
    if ("error" in built) throw new Error(built.error)
    expect(built.map((field) => [field.key, field.type])).toEqual([
      ["host", "string"],
      ["password", "secret"],
      ["folder", "string"],
      ["folders", "multiselect"],
      ["ssl", "boolean"],
      ["port", "number"],
      ["allow", "external"],
    ])
    expect(built[0]).toMatchObject({
      title: "Адрес сервера",
      description: "Из настроек",
      placeholder: "mail.example.com",
    })
    expect(built[2]).toMatchObject({ options: [{ value: "inbox", label: "Входящие" }] })
    expect("custom" in built[2]!).toBe(false)
    expect(built[3]).toMatchObject({ type: "multiselect", custom: true })
  })
  test("bad keys, duplicates, a choice without options, a link without url are refused", () => {
    const one = (field: Record<string, unknown>) =>
      BuffSetupFormPlugin.fields({ title: "t", note: "", fields: [field as never] })
    expect(one({ key: "has space", label: "x", kind: "text", required: true })).toEqual({
      error: "Field key must be a Latin identifier: has space",
    })
    expect(one({ key: "c", label: "x", kind: "choice", required: true })).toEqual({
      error: "A choice field needs options: c",
    })
    expect(one({ key: "m", label: "x", kind: "multi", required: true })).toEqual({
      error: "A multi field needs options: m",
    })
    expect(one({ key: "l", label: "x", kind: "link", required: true })).toEqual({
      error: "A link field needs a valid url: l",
    })
    expect(
      BuffSetupFormPlugin.fields({
        title: "t",
        note: "",
        fields: [
          { key: "a", label: "x", kind: "text", required: true },
          { key: "a", label: "y", kind: "text", required: true },
        ],
      }),
    ).toEqual({ error: "Duplicate field key: a" })
  })
})

describe("what the model hears", () => {
  test("values by key; the secret as a reference with its token; empties and links marked", () => {
    const text = BuffSetupFormPlugin.reply(input, {
      host: "mail.example.com",
      password: "secret:sec_42",
      folders: ["inbox", "Черновики"],
      ssl: true,
      allow: true,
    })
    expect(text).toContain("host: mail.example.com")
    expect(text).toContain("password: secret:sec_42 — a reference; put {secret:sec_42} where")
    expect(text).toContain("folder: (empty)")
    expect(text).toContain("folders: inbox, Черновики")
    expect(text).toContain("ssl: true")
    expect(text).toContain("allow: opened")
    expect(text).not.toContain("hunter2")
  })
  test("no service names in the tool description", () => {
    expect(BuffSetupFormPlugin.description).not.toMatch(/\b(gmail|google|figma|imap|slack|notion)\b/i)
  })
})
