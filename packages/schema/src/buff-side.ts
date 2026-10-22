export * as BuffSide from "./buff-side.js"

import { Schema } from "effect"
import { define } from "./rpc.js"
import { BuffI18n } from "./buff-i18n.js"

/**
 * Побочный диалог (#464), как в ZCode: ответвление основной сессии на текущем месте — видит её
 * контекст, работает с обычными инструментами, основную не трогает. Хранится: список побочных
 * у основной сессии, открываются снова. Здесь — номер, название и RPC; одинаково для окна и консоли.
 */

/** at — когда открыт: история до него скопирована из основной и в побочном не показывается. */
export const Side = Schema.Struct({ id: Schema.String, n: Schema.Number, at: Schema.Number })
export type Side = typeof Side.Type

export function title(n: number, t: BuffI18n.T = BuffI18n.english): string {
  return t("Side conversation {n}", { n })
}

export function next(sides: readonly Side[]): number {
  return sides.reduce((top, side) => Math.max(top, side.n), 0) + 1
}

export function parse(text: string): { readonly text?: string } {
  const trimmed = text.trim()
  return trimmed ? { text: trimmed } : {}
}

/** Где ядро хранит побочные диалоги основной сессии — одно место для их списка и для отметок. */
export const STORAGE_PREFIX = "buff.side:"
export const storageKey = (session: string): string => `${STORAGE_PREFIX}${session}`

const decodeSides = Schema.decodeUnknownOption(Schema.Array(Side))

/** Все побочные диалоги по сохранённым спискам основных сессий; испорченная запись пропускается. */
export function sideIDs(kept: readonly unknown[]): string[] {
  return kept.flatMap((value) => {
    const sides = decodeSides(value)
    return sides._tag === "Some" ? sides.value.map((side) => side.id) : []
  })
}

const portable = Schema.toStandardSchemaV1

export const Rpc = define({
  id: "buff.side",
  methods: {
    list: {
      input: portable(Schema.Struct({ session: Schema.String })),
      output: portable(Schema.Struct({ sides: Schema.Array(Side) })),
    },
    /** Открыть новый побочный диалог; с текстом — сразу задать его первым сообщением. */
    open: {
      input: portable(Schema.Struct({ session: Schema.String, text: Schema.optional(Schema.String) })),
      output: portable(Schema.Struct({ side: Side })),
    },
  },
  events: {
    /** Побочный диалог открыт (из окна, консоли или командой /side) — его вкладку показывают. */
    opened: { schema: portable(Schema.Struct({ session: Schema.String, side: Side })) },
  },
})
