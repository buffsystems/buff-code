/** Русский каталог (#628): ошибки разбора командной строки buff — фразы effect/cli и схемы. */
export const cliErrors = {
  ERROR: "ОШИБКА",
  ERRORS: "ОШИБКИ",
  "Did you mean this?": "Может быть, имелось в виду:",
  "Unrecognized flag: {option} in command {command}": "Неизвестный флаг {option} в команде {command}",
  "Unrecognized flag: {option}": "Неизвестный флаг {option}",
  'Duplicate flag name "{option}" in parent command "{parent}" and subcommand "{child}". Parent will always claim this flag (Mode A semantics). Consider renaming one of them to avoid confusion.':
    "Флаг «{option}» есть и у команды «{parent}», и у её подкоманды «{child}». Его всегда забирает команда (режим A) — переименуйте один из них.",
  "Missing required flag: --{option}": "Не указан обязательный флаг --{option}",
  "Missing required argument: {argument}": "Не указан обязательный аргумент {argument}",
  "Unexpected positional argument: {list}|Unexpected positional arguments: {list}":
    "Лишний аргумент: {list}|Лишние аргументы: {list}|Лишние аргументы: {list}",
  'Invalid value for argument <{name}>: "{value}". {expectation}':
    "Неверное значение аргумента <{name}>: «{value}». {expectation}",
  "Missing value for flag --{name}. {expectation}": "Не указано значение флага --{name}. {expectation}",
  'Invalid value for flag --{name}: "{value}". {expectation}':
    "Неверное значение флага --{name}: «{value}». {expectation}",
  'Unknown subcommand "{name}" for "{parent}"': "Неизвестная подкоманда «{name}» у «{parent}»",
  'Unknown subcommand "{name}"': "Неизвестная подкоманда «{name}»",
  // Что ожидалось.
  "Expected: {what}": "Ожидается: {what}",
  "Expected {list}": "Ожидается: {list}",
  // «Expected an integer» — уже в каталоге консоли.
  "Expected a string representing a finite number": "Нужно число",
  "Schema validation failed: {reason}": "{reason}",
  "Expected a value between {min} and {max}": "значение от {min} до {max}",
  "Expected a value greater than or equal to {min}": "значение не меньше {min}",
  "Expected a value less than or equal to {max}": "значение не больше {max}",
  "Expected a value with a length of at least {min}": "значение длиной не меньше {min}",
  "Invalid key=value format. Expected format: key=value, got: {value}": "ключ=значение (получено: {value})",
  "Invalid key=value format. Both key and value must be non-empty. Got: {value}":
    "ключ=значение с непустыми ключом и значением (получено: {value})",
  "omit the value and use {raw} by itself to set --{name} to false":
    "флаг без значения: --no-{name} сам ставит --{name} в false",
  "at least {n} value|at least {n} values": "не меньше {n} значения|не меньше {n} значений|не меньше {n} значений",
  "at most {n} value|at most {n} values": "не больше {n} значения|не больше {n} значений|не больше {n} значений",
  "{n} value|{n} values": "{n} значение|{n} значения|{n} значений",
  "Expected an HTTP(S) server URL without credentials, query parameters, or a fragment":
    "Ожидается адрес сервера HTTP(S) без учётных данных, параметров запроса и фрагмента",
}
