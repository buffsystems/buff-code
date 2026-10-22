import type { FormAnswer } from "@opencode/client/promise"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { formatServerError } from "@/runtime/server/errors"

/**
 * Отказ входа в окне подключения (#458). У апстрима причина терялась («Authorization failed:
 * [object Object]»), окно оставалось без действий, а введённый адрес пропадал. Здесь решается,
 * что показать: причину — словами сервера; если вход спрашивал адрес — снова форму с этим
 * адресом, чтобы поправить его и повторить.
 */
export type SignInFailure =
  | { readonly back: "form"; readonly message: string; readonly answer: FormAnswer }
  | { readonly back: "error"; readonly message: string }

export function signInFailure(
  error: unknown,
  answer: FormAnswer | undefined,
  t: BuffI18n.T = BuffI18n.english,
): SignInFailure {
  const message = formatServerError(error, undefined, t("Could not sign in. Try again."))
  return answer ? { back: "form", message, answer } : { back: "error", message }
}
