// Buff (#636): что машина сообщает телефонам, пока приложение закрыто, — агент ждёт разрешения,
// задал вопрос, ход завершился или упал. Коротко: что случилось, в какой сессии, и ссылка на её
// экран (buff://<машина>/session/<сессия>?project=<проект>). Запечатывает и шлёт агент (через push шлюза).

import type { PushMessage } from "@buff/mobile-protocol"
import { BuffLocale } from "../locale.js"

export type NoticeKind = "permission" | "question" | "done" | "failed"

/** Событие шины — в вид уведомления; остальные события телефону не сообщаются. */
export function noticeKindOf(type: string): NoticeKind | null {
  if (type === "permission.asked") return "permission"
  if (type === "form.created") return "question"
  if (type === "session.execution.succeeded") return "done"
  if (type === "session.execution.failed") return "failed"
  return null
}

const TITLE: Record<NoticeKind, string> = {
  permission: "The agent waits for a permission",
  question: "The agent asked a question",
  done: "The turn is done",
  failed: "The session failed",
}

// Типы — те же, что у кабинета (bc_*): телефон по ним рисует значок и группу.
const TYPE: Record<NoticeKind, string> = {
  permission: "bc_permission",
  question: "bc_question",
  done: "bc_turn_complete",
  failed: "bc_error",
}

export function machineNotice(
  kind: NoticeKind,
  session: { id: string; title: string; project: string },
  machine: { id: string; name: string },
  now: number,
): PushMessage {
  return {
    title: BuffLocale.t(TITLE[kind]),
    body: `${session.title || BuffLocale.t("Session")} · ${machine.name}`.slice(0, 600),
    link: `buff://${machine.id}/session/${encodeURIComponent(session.id)}${session.project ? `?project=${encodeURIComponent(session.project)}` : ""}`,
    at: now,
    type: TYPE[kind],
  }
}
