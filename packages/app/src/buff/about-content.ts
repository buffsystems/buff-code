import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffLinks } from "@opencode/schema/buff-links"

/**
 * Содержание страницы «About» в Buff Code (#462). Страница апстрима рассказывает о нём самом:
 * его авторы, его сайт, его знак. Наша — о Buff Code, с нашими адресами; происхождение от
 * OpenCode названо отдельным блоком, как требует лицензия MIT.
 */
export interface AboutContent {
  readonly version: string
  readonly description: string
  readonly links: readonly { readonly label: string; readonly href: string }[]
  readonly origin: readonly string[]
}

/** Слова — через переводчика экрана (#472); без него — английские исходные строки. Ссылки на сайт —
 *  на языке экрана (#720). */
export function aboutContent(
  version: string | undefined,
  t: BuffI18n.T = BuffI18n.english,
  locale: BuffI18n.Locale = BuffI18n.DEFAULT_LOCALE,
): AboutContent {
  return {
    version: version ? t("Version {version}", { version }) : t("Development build"),
    description: t("Buff Code is the development tool of the Buff platform: an agent for working with code in the window and in the console."),
    links: [
      { label: "buff.systems", href: BuffLinks.localized(BuffLinks.site, locale) },
      { label: t("Documentation"), href: BuffLinks.localized(BuffLinks.docs, locale) },
      { label: BuffLinks.supportAddress, href: BuffLinks.support },
    ],
    origin: [
      t("Based on OpenCode, an open coding agent released under the MIT license."),
      "OpenCode © Anomaly Innovations, Inc.",
      t("OpenCode is a registered trademark of Anomaly Innovations, Inc."),
    ],
  }
}
