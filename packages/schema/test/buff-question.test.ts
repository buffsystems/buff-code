// Вариант ответа «(Recommended)» (#470): модель помечает рекомендуемый вариант по-английски, как
// велит описание инструмента вопроса, — человек видел «Не трогать (Recommended)» в русском окне.
import { expect, test } from "bun:test"
import { BuffQuestion } from "../src/buff-question.js"

const ru = (text: string, params?: Record<string, string | number>) =>
  text === "{label} (recommended)" ? `${params?.label} (рекомендуется)` : text

test("метка рекомендации — на языке интерфейса", () => {
  expect(BuffQuestion.optionLabel("Не трогать (Recommended)", ru)).toBe("Не трогать (рекомендуется)")
  expect(BuffQuestion.optionLabel("Keep it (recommended) ", ru)).toBe("Keep it (рекомендуется)")
})

test("вариант без метки — как есть", () => {
  expect(BuffQuestion.optionLabel("Убрать в stash", ru)).toBe("Убрать в stash")
  expect(BuffQuestion.optionLabel("Recommended reading", ru)).toBe("Recommended reading")
})
