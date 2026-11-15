// Buff (#929): отказ команды телефона — на языке телефона. Каждая команда несёт `args.lang`; отказ
// бросается английским исходником с параметрами и переводится один раз, на границе команды. Пока
// его не перевели (окно и консоль зовут те же действия), он на языке машины.
import { RefusalError } from "@buff/mobile-protocol"
import { BuffI18n } from "@opencode/schema/buff-i18n"
import { BuffLocale } from "../locale.js"

export class PhoneRefusal extends RefusalError {
  constructor(
    readonly source: string,
    readonly params?: BuffI18n.Params,
  ) {
    super(BuffLocale.t(source, params))
  }
}

/** Отказ, который человек прочтёт как есть: строка — английский исходник каталога переводов. */
export const phoneRefusal = (text: string, params?: BuffI18n.Params) => new PhoneRefusal(text, params)

/** Отказ на языке команды (`args.lang`); без языка или не отказ — как был. */
export function inLanguage(err: unknown, args: unknown): unknown {
  if (!(err instanceof PhoneRefusal)) return err
  const lang = (args as { lang?: unknown } | null)?.lang
  if (lang !== "ru" && lang !== "en") return err
  return new RefusalError(BuffI18n.t(lang, err.source, err.params))
}
