import { BuffI18n } from "@opencode/schema/buff-i18n"
import { formatServerError } from "@/runtime/server/errors"

/**
 * Сбой создания сессии не теряет набранное (#458). Апстрим превращал черновик в сессию сразу,
 * не дожидаясь ответа службы: при сбое вкладка указывала на сессию, которой нет, а сообщение
 * пропадало. Черновик идёт дальше только после того, как сессия создана.
 */
export async function sessionCreated(
  creation: Promise<{ ok: boolean }>,
  rollback: () => Promise<void>,
): Promise<boolean> {
  if ((await creation).ok) return true
  await rollback()
  return false
}

// Так клиент называет ответ службы, который не смог прочитать.
const UNREADABLE = "UnexpectedStatus"

export function sessionCreateFailure(error: unknown, t: BuffI18n.T = BuffI18n.english): string {
  const reason = formatServerError(error, undefined, UNREADABLE).replace(/\.$/, "")
  return t("{reason}. The message is still in the input box — send it again.", {
    reason: !reason || reason === UNREADABLE ? t("The local Buff Code service returned an error") : reason,
  })
}
