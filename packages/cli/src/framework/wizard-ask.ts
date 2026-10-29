import { Console, Effect, Option, Redacted } from "effect"
import { type Command, Param, Prompt } from "effect/unstable/cli"
import type { BuffI18n } from "@opencode/schema/buff-i18n"
import { Help } from "./help"

/**
 * Вопросы мастера команды (`buff --wizard`, #628) об одном аргументе или флаге — на языке `t`.
 * Подпись вопроса — описание из справки; «да/нет» — переключатель с подписями на языке человека
 * (подтверждение effect/cli понимает только латинские y/n); числа проверяются здесь же, со своим
 * текстом ошибки (у числового вопроса effect/cli он английский и не задаётся).
 */

type T = BuffI18n.T
/** Слово итоговой команды: что передать и что показать (секрет не показывается). */
export type Line = { readonly value: string; readonly shown: string }

/** Аргументы и флаги команды по порядку объявления (вложенные группы — тоже). */
export function params(config: Command.Command.Config): Param.Any[] {
  return Object.values(config).flatMap((value) =>
    Param.isParam(value)
      ? [value as Param.Any]
      : Array.isArray(value)
        ? value.flatMap((item) => params({ item }))
        : params(value as Command.Command.Config),
  )
}

type Single = Param.Single<Param.ParamKind, unknown>

/** Сам аргумент или флаг под обёртками (необязательный, список, преобразование). */
export function single(param: Param.Any): Single {
  return param._tag === "Single" ? (param as Single) : single((param as Param.Optional<Param.ParamKind, unknown>).param)
}

/** Необязателен ли и сколько значений не меньше — по обёрткам параметра. */
function shape(param: Param.Any): { optional: boolean; variadic: boolean; min: number } {
  if (param._tag === "Single") return { optional: false, variadic: false, min: 0 }
  const inner = shape((param as Param.Optional<Param.ParamKind, unknown>).param)
  if (param._tag === "Optional") return { ...inner, optional: true }
  if (param._tag === "Variadic") {
    const min = Option.getOrElse((param as Param.Variadic<Param.ParamKind, unknown>).min, () => 0)
    return { ...inner, variadic: true, min }
  }
  return inner
}

export const line = (value: string, shown = value): Line => ({ value, shown })

export const yesNo = (t: T, message: string, initial: boolean) =>
  Prompt.run(Prompt.toggle({ message, initial, active: t("yes"), inactive: t("no") }))

function label(param: Single, t: T): string {
  const description = Option.getOrUndefined(param.description)?.trim()
  const text = description ? Help.localize(description, t) : param.name
  return param.kind === Param.flagKind ? `${text} (--${param.name})` : text
}

function number(t: T, message: string, integer: boolean, min = Number.NEGATIVE_INFINITY) {
  return Prompt.run(
    Prompt.text({
      message,
      validate: (value) => {
        const parsed = Number(value.trim())
        if (value.trim() === "" || Number.isNaN(parsed) || (integer && !Number.isInteger(parsed)))
          return Effect.fail(integer ? t("Expected an integer") : t("Expected a number"))
        if (parsed < min) return Effect.fail(t("Must be at least {min}", { min }))
        return Effect.succeed(value.trim())
      },
    }),
  )
}

function value(param: Single, t: T) {
  const message = label(param, t)
  const primitive = param.primitiveType
  switch (primitive._tag) {
    case "Boolean":
      return Effect.map(yesNo(t, message, false), (answer) => line(String(answer)))
    case "Choice": {
      // Варианты выбора effect/cli хранит в самом разборщике значения.
      const choices = (primitive as { readonly choiceKeys?: ReadonlyArray<string> }).choiceKeys ?? []
      return Effect.map(
        Prompt.run(Prompt.select({ message, choices: choices.map((key) => ({ title: key, value: key })) })),
        line,
      )
    }
    case "Integer":
    case "Float":
      return Effect.map(number(t, message, primitive._tag === "Integer"), line)
    case "Redacted":
      return Effect.map(Prompt.run(Prompt.password({ message })), (secret) =>
        line(Redacted.value(secret), "<redacted>"),
      )
    default:
      return Effect.map(Prompt.run(Prompt.text({ message })), line)
  }
}

export const ask = Effect.fnUntraced(function* (param: Param.Any, t: T) {
  const base = single(param)
  const { optional, variadic, min } = shape(param)
  if (optional && !(yield* yesNo(t, t("Set {name}?", { name: label(base, t) }), false))) {
    yield* Console.log()
    return [] as Line[]
  }
  const count = variadic
    ? Number(yield* number(t, t("{name}: how many values?", { name: label(base, t) }), true, min))
    : 1
  const values: Line[] = []
  for (let index = 0; index < count; index++) values.push(yield* value(base, t))
  const raw = values.map((item) => item.value)
  yield* param.parse(
    base.kind === Param.flagKind ? { flags: { [base.name]: raw }, arguments: [] } : { flags: {}, arguments: raw },
  )
  yield* Console.log()
  return base.kind === Param.argumentKind ? values : values.flatMap((item) => [line(`--${base.name}`), item])
})

export * as WizardAsk from "./wizard-ask"
