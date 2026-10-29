// Уведомления машины на телефон (#636): какие события сообщаются и как выглядит уведомление.
import { describe, expect, test } from "bun:test"
import { machineNotice, noticeKindOf } from "../../src/buff/mobile/notify"

describe("machine notices", () => {
  test("a permission, a question, a finished or failed turn are told; the rest is not", () => {
    expect(["permission.asked", "form.created", "session.execution.succeeded", "session.execution.failed", "session.execution.started"].map(noticeKindOf)).toEqual(["permission", "question", "done", "failed", null])
  })

  test("the notice names what happened, the session and the machine, and opens the session", () => {
    expect(machineNotice("permission", { id: "ses_1", title: "Поиск", project: "p/1" }, { id: "M", name: "laptop" }, 7)).toEqual({
      title: "Агент ждёт разрешения",
      body: "Поиск · laptop",
      link: "buff://M/session/ses_1?project=p%2F1",
      at: 7,
      type: "bc_permission",
    })
    expect(machineNotice("done", { id: "s", title: "", project: "" }, { id: "M", name: "laptop" }, 7)).toMatchObject({
      body: "Сессия · laptop",
      link: "buff://M/session/s",
      type: "bc_turn_complete",
    })
    expect(["question", "failed"].map((k) => machineNotice(k as "question", { id: "s", title: "", project: "" }, { id: "M", name: "l" }, 7).type)).toEqual(["bc_question", "bc_error"])
  })
})
