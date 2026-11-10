export * as SessionError from "./session-error.js"

import { Schema } from "effect"
import { optional } from "./schema.js"

export interface Error extends Schema.Schema.Type<typeof Error> {}
export const Error = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })).pipe(optional),
  /**
   * Файлы в запросе, который модель отвергла (#757): по ним клиенты предлагают разобрать файлы
   * кодом, сменить модель или продолжить без них. Нет поля — файлы ни при чём.
   */
  attachments: Schema.Array(
    Schema.Struct({ name: Schema.String.pipe(optional), mime: Schema.String }).annotate({
      identifier: "Session.StructuredError.Attachment",
    }),
  ).pipe(optional),
}).annotate({ identifier: "Session.StructuredError" })
