/**
 * Адреса, на которые Buff Code отправляет человека (#462): документация, поддержка, «что
 * нового». Один список для десктопа и консоли — у апстрима эти адреса разбросаны по экранам и
 * ведут на его сайт, Discord и трекер. Значения согласованы с `buff/brand.json`; сторож —
 * `buff/test/links.test.ts`.
 */
const SITE = "https://buff.systems"
const DOCS = `${SITE}/docs/buff-code`
const SUPPORT = "support@buff.systems"

export const BuffLinks = {
  site: SITE,
  docs: DOCS,
  /** Вход и рабочий контекст: где взять адрес коннектора, код из кабинета (#457). */
  signIn: `${DOCS}/sign-in`,
  /** Что делать, когда приложение не запускается, не входит или не отвечает. */
  troubleshooting: `${DOCS}/troubleshooting`,
  /** «Что нового» — файл выпуска в канале обновлений; до первого выпуска с ним адрес пуст. */
  changelog: `${SITE}/update/api/latest/desktop/buff-code/changelog.json`,
  /** Выпуски консоли (#597): `<версия>/buff-<платформа>.tar.gz` и `<версия>/SHA256SUMS` — их же ставит `buff/install`. */
  downloads: `${SITE}/downloads`,
  /** Последняя выпущенная версия консоли — ответ, который читают `buff/install` и обновление. */
  latestCli: `${SITE}/update/api/latest/cli/npm`,
  support: `mailto:${SUPPORT}`,
  supportAddress: SUPPORT,
  /** Письмо в поддержку с готовой темой; текст письма человек пишет сам. */
  supportMail: (subject: string): string => `mailto:${SUPPORT}?subject=${encodeURIComponent(subject)}`,
} as const
