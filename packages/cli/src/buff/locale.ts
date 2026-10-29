import { BuffI18n } from "@opencode/schema/buff-i18n"
import { adoptLocale, currentLocale } from "@opencode/tui/feature-plugins/buff/locale-state"

/**
 * Язык разовых команд (#472): тот, что выбран в окне, — его хранит служба Buff; пока не выбран
 * или служба не ответила — язык системы (#713). Значение — общее с консолью (`locale-state` в tui), поэтому
 * и строки консоли, которые показывают команды (формы входа), идут на том же языке.
 */

export { n, t } from "@opencode/tui/feature-plugins/buff/locale-state"

/** Спросить язык у службы; не ответила — остаётся прежний. */
export async function followLocale(read: () => Promise<unknown>): Promise<void> {
  const answer = await read().catch(() => currentLocale())
  adoptLocale(BuffI18n.locale(typeof answer === "string" ? answer : undefined))
}
