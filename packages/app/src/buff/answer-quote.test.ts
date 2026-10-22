// «Добавить в сообщение» (#459): кнопка появляется только у выделения внутри ответа модели.
import { expect, test } from "bun:test"
import { answerSelection } from "./answer-quote"

function page() {
  document.body.innerHTML = `
    <div data-slot="session-turn-assistant-content">
      <div data-component="text-part"><div data-slot="text-part-body"><p id="a">Ответ модели: шаг первый.</p></div></div>
    </div>
    <div data-component="user-message"><p id="u">Вопрос человека</p></div>`
}

function select(from: string, to = from) {
  const range = document.createRange()
  range.setStart(document.getElementById(from)!.firstChild!, 0)
  const end = document.getElementById(to)!.firstChild!
  range.setEnd(end, end.textContent!.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

test("a selection inside an answer is offered for the message", () => {
  page()
  expect(answerSelection(select("a"))?.text).toBe("Ответ модели: шаг первый.")
})

test("a selection outside an answer, or reaching out of it, is not", () => {
  page()
  expect(answerSelection(select("u"))).toBeUndefined()
  expect(answerSelection(select("a", "u"))).toBeUndefined()
})

test("an empty selection is not", () => {
  page()
  window.getSelection()!.removeAllRanges()
  expect(answerSelection(window.getSelection())).toBeUndefined()
})
