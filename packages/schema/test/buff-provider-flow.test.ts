// Свой OpenAI-совместимый сервер из консоли (#562): вопросы по очереди, диалог и сервер приходят снаружи.
import { describe, expect, test } from "bun:test"
import { BuffI18n } from "../src/buff-i18n.js"
import type { BuffProvider } from "../src/buff-provider.js"
import { BuffProviderFlow } from "../src/buff-provider-flow.js"

const ru: BuffI18n.T = (text, params) => BuffI18n.t("ru", text, params)

/** Интерфейс, отвечающий заранее заданными ответами; запоминает, что спросили. */
function ui(answers: unknown[], discovered: BuffProvider.Discovered = { models: ["gpt-mock", "claude-mock"] }) {
  const asked: string[] = []
  const looked: { baseURL: string; key?: string }[] = []
  const next = (title: string) => {
    asked.push(title)
    return Promise.resolve(answers.shift())
  }
  const dialogs: BuffProviderFlow.Ui = {
    select: (dialog) => next(dialog.title) as never,
    prompt: (dialog) => next(dialog.title) as Promise<string | undefined>,
    t: ru,
  }
  const models = (input: { baseURL: string; key?: string }) => {
    looked.push(input)
    return Promise.resolve(discovered)
  }
  return { dialogs, asked, looked, models }
}

describe("adding", () => {
  test("LiteLLM: the address, the key, every model the server lists", async () => {
    const { dialogs, asked, looked, models } = ui(["", "http://localhost:4000/v1", "sk-test", BuffProviderFlow.ALL])
    expect(await BuffProviderFlow.add(dialogs, models, "litellm")).toEqual({
      id: "litellm",
      name: "LiteLLM",
      baseURL: "http://localhost:4000/v1",
      key: "sk-test",
      models: [{ id: "gpt-mock" }, { id: "claude-mock" }],
    })
    expect(asked).toEqual(["Название", "Адрес сервера", "Ключ", "Модели LiteLLM"])
    expect(looked).toEqual([{ baseURL: "http://localhost:4000/v1", key: "sk-test" }])
  })

  test("another server: its own name and ID, one model, no key", async () => {
    const { dialogs, asked, models } = ui(["Office vLLM", "", "http://gpu:8000/v1", "", "claude-mock"])
    expect(await BuffProviderFlow.add(dialogs, models, "custom")).toEqual({
      id: "office-vllm",
      name: "Office vLLM",
      baseURL: "http://gpu:8000/v1",
      models: [{ id: "claude-mock" }],
    })
    expect(asked).toEqual(["Название", "Идентификатор провайдера", "Адрес сервера", "Ключ", "Модели Office vLLM"])
  })

  test("a server that lists nothing takes models by hand", async () => {
    const { dialogs, asked, models } = ui(["", "http://h/v1", "", BuffProviderFlow.MANUAL, "a, b"], { models: [] })
    expect(await BuffProviderFlow.add(dialogs, models, "litellm")).toMatchObject({ models: [{ id: "a" }, { id: "b" }] })
    expect(asked.at(-2)).toBe("Сервер не отдал ни одной модели — добавьте их вручную.")
    expect(asked.at(-1)).toBe("Идентификаторы моделей через запятую")
  })

  test("a refused list says whose problem it is and still lets one type models", async () => {
    const refused: BuffProvider.Discovered = { error: { type: "provider.auth", message: "bad key", status: 401 } }
    const { dialogs, asked, models } = ui(["", "http://h/v1", "bad", BuffProviderFlow.MANUAL, "m1"], refused)
    expect(await BuffProviderFlow.add(dialogs, models, "litellm")).toMatchObject({ models: [{ id: "m1" }] })
    expect(asked.at(-2)).toStartWith("LiteLLM отклонил ключ (ответ 401: bad key).")
  })

  test("leaving any question stops; a wrong address is a problem, not a save", async () => {
    expect(await BuffProviderFlow.add(ui([undefined]).dialogs, ui([]).models, "litellm")).toBeUndefined()
    const { dialogs, models } = ui(["", "localhost:4000", "", BuffProviderFlow.MANUAL, "m1"])
    expect(await BuffProviderFlow.add(dialogs, models, "litellm")).toEqual({
      problem: "Адрес должен начинаться с http:// или https://.",
    })
  })
})

describe("the check", () => {
  test("an answer reads with its time; a refusal in the words of a failed turn", () => {
    expect(BuffProviderFlow.checked({ ms: 1234, text: "OK" }, "litellm", "LiteLLM", ru)).toEqual({
      ok: true,
      text: "Работает: ответ за 1.2 с — «OK»",
    })
    const refused = { error: { type: "provider.auth", message: "User not found.", status: 401 } }
    expect(BuffProviderFlow.checked(refused, "openrouter", "OpenRouter", ru)).toMatchObject({ ok: false })
    expect(BuffProviderFlow.checked(refused, "openrouter", "OpenRouter", ru).text).toStartWith(
      "OpenRouter отклонил ключ (ответ 401: User not found).",
    )
  })
})
