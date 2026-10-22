// Отказ с пояснением (#450): текст человека должен дойти до модели, а не потеряться за
// общей фразой инструмента «Unable to edit …».
import { expect, test } from "bun:test"
import { ToolFailure } from "@opencode/ai"
import { Permission } from "../../src/permission.js"
import { toSessionError } from "../../src/session/to-session-error.js"

test("the model is told what the person wrote when declining a tool call", () => {
  const declined = new ToolFailure({
    message: "Unable to edit a.txt",
    error: new Permission.CorrectedError({ feedback: "Файл не трогай, ответь одной строкой" }),
  })
  expect(toSessionError(declined).message).toContain("Файл не трогай, ответь одной строкой")
})
