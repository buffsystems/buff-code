export * as Question from "./question.js"

import { Schema } from "effect"

const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
})

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  // Buff (#707): обязательное — слабая модель пропускает необязательное поле, и «выберите несколько»
  // приходит с выбором одного.
  multiple: Schema.Boolean.annotate({
    description: "true when the person may pick several options (which of these to include, use, keep); false when exactly one",
  }),
}

export const Prompt = Schema.Struct(base).annotate({ identifier: "Question.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "Question.Answer" })
export type Answer = typeof Answer.Type
