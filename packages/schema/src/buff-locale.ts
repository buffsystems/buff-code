export * as BuffLocale from "./buff-locale.js"

import { Schema } from "effect"
import { define } from "./rpc.js"

/**
 * Язык Buff (#472): один на окно, консоль и ядро. Окно сообщает выбранный в настройках язык,
 * консоль и ядро берут его отсюда. Хранит ядро (`core/src/buff/locale.ts`); пока язык не выбран —
 * русский.
 */

export const Locale = Schema.Literals(["ru", "en"])
export type Locale = typeof Locale.Type

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.locale",
  methods: {
    get: { input: portable(Schema.Undefined), output: portable(Locale) },
    set: { input: portable(Locale), output: portable(Locale) },
  },
  events: { changed: { schema: portable(Schema.Struct({ locale: Locale })) } },
})
