export * as BuffTodoPlugin from "./todo.js"

import { Effect, Schema } from "effect"
import { ToolFailure } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffTodo } from "@opencode/schema/buff-todo"

/**
 * Список дел (#463), как в ZCode: модель ведёт его по ходу работы, человек видит прогресс над
 * полем ввода и карточку в ленте. Хранить нечего: текущий список — последний вызов в сессии.
 */

export const description = `Keep the session's todo list: the user sees it as your working plan, with progress ("3/7 · current item") above the input and a card in the conversation.

Use it the moment a task needs three or more distinct steps, or the user hands you a list of things to do. Skip it for a single quick step or a pure question.

Send the whole list on every call — it replaces the previous one. Keep exactly one item in_progress while you work, mark an item completed the moment it is done, add items you discover on the way. Write items in the user's language.`

export const Input = Schema.Struct({
  todos: Schema.Array(BuffTodo.Item).annotate({ description: "The complete updated list." }),
})

const Output = Schema.Struct({ done: Schema.Number, total: Schema.Number })

export function reply(items: readonly BuffTodo.Item[]): string {
  const state = BuffTodo.progress(items)
  return `Todo list updated: ${state.done}/${state.total} done.${state.current ? ` Current: ${state.current}.` : ""}`
}

export const Plugin = define({
  id: "buff.todo",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: BuffTodo.TOOL,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) => {
            const problems = BuffTodo.problems(input.todos)
            if (problems.length) return Effect.fail(new ToolFailure({ message: problems.join("\n") }))
            const state = BuffTodo.progress(input.todos)
            return Effect.succeed({ output: { done: state.done, total: state.total }, content: reply(input.todos) })
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
})
