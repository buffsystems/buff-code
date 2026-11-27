export * as BuffChatPlugin from "./buff-chat-plugin.js"

import { Schema } from "effect"
import { BuffI18n } from "./buff-i18n.js"
import { define } from "./rpc.js"

/**
 * Плагины чатов (#595): модель пишет в ответе блок кода с именем плагина, клиент вместо кода
 * рисует его отрисовщиком в изолированной рамке. Плагин — папка на машине; здесь её формат и
 * всё, что одинаково для ядра, окна, консоли, веба и телефона. Читает и раздаёт папки ядро
 * (`core/src/buff/chat-plugin.ts`).
 */

/** Папка плагинов в каталоге конфигурации пользователя и в личной папке проекта. */
export const DIR = "chat-plugins"

export const FILES = {
  /** Описание: имя, когда плагин нужен, какие блоки рисует. */
  manifest: "plugin.json",
  /** Отрисовщик: одна самодостаточная страница, сети у неё нет. */
  view: "view.html",
  /**
   * Инструкция модели: как писать блок. Модель подгружает её сама, когда плагин понадобился —
   * в промпте всегда только имя и описание (как у навыков). Большой плагин держит здесь
   * главное и ссылки, а подробности по вариантам — в справочниках `guide/*.md`.
   */
  guide: "GUIDE.md",
  /** Справочники к инструкции: читаются по ссылке из неё, только нужный. */
  references: "guide",
  /** Необязательный текст для консоли: `text(data, { width })` возвращает строку. */
  text: "text.js",
  /** Примеры содержимого блока: самопроверка и показ в настройках. */
  examples: "examples",
} as const

/** Границы формата: отрисовщик едет на телефон частями, инструкция — в каждый запрос модели. */
export const LIMITS = {
  viewBytes: 4 * 1024 * 1024,
  /** Основная инструкция — порядка 5 тысяч токенов; остальное уходит в справочники. */
  guideChars: 20_000,
  /** Описание всегда в промпте: что рисует и когда нужен. */
  descriptionChars: 800,
  /** Имя и строка для людей в списках. */
  labelChars: 200,
  referenceBytes: 256 * 1024,
  exampleBytes: 256 * 1024,
  /** What one visual may tell the model about its state, and how many visuals of a chat are kept. */
  contextChars: 8000,
  contextFrames: 20,
} as const

/** Откуда плагин: встроен в Buff Code, лежит у пользователя (все проекты) или в личной папке проекта. */
export const Origin = Schema.Literals(["builtin", "user", "local"])
export type Origin = typeof Origin.Type

/** Куда пишут свой плагин. */
export const Scope = Schema.Literals(["user", "local"])
export type Scope = typeof Scope.Type

/**
 * Что человек читает в списках на своём языке: имя и одна строка «что это». `description` —
 * для модели (когда плагин нужен) и остаётся как написано.
 */
export const Label = Schema.Struct({ name: Schema.optional(Schema.String), summary: Schema.optional(Schema.String) })
export type Label = typeof Label.Type
const Labels = Schema.optional(Schema.Record(Schema.String, Label))

export const Manifest = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** По языку («ru», «en»): имя и строка для людей. */
  labels: Labels,
  blocks: Schema.Array(Schema.String),
  /** Обычная высота визуализации, px: рамка ждёт на ней, и лента не прыгает. */
  height: Schema.optional(Schema.Finite),
})
export type Manifest = typeof Manifest.Type

export const Entry = Schema.Struct({
  /** Имя папки плагина. */
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  /** По языку: имя и строка для людей — если плагин их дал. */
  labels: Labels,
  /** Имена блоков кода, которые плагин рисует. */
  blocks: Schema.Array(Schema.String),
  /** Обычная высота визуализации, px — если плагин её назвал. */
  height: Schema.optional(Schema.Finite),
  origin: Origin,
  /** Отпечаток содержимого папки: клиент держит отрисовщик в кэше, пока он не сменился. */
  version: Schema.String,
  /** Выключенный плагин не рисует блоки, и модель о нём не знает. */
  enabled: Schema.Boolean,
  /** Есть текст для консоли. */
  text: Schema.Boolean,
  /** Имена примеров. */
  examples: Schema.Array(Schema.String),
  /** Почему плагин не работает (нет отрисовщика, испорчено описание), словами. */
  problem: Schema.optional(Schema.String),
})
export type Entry = typeof Entry.Type

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Reason = portable(Schema.Struct({}))
const Target = Schema.Struct({ id: Schema.String })
const Failures = { invalid: Reason, unwritable: Reason }

/** Задание, которого ещё ждут, как его получает клиент, читающий чат снимками (телефон, веб). */
export const PendingTest = Schema.Struct({
  call: Schema.String,
  id: Schema.String,
  version: Schema.String,
  name: Schema.String,
  examples: Schema.Array(Schema.Struct({ name: Schema.String, block: Schema.String })),
})
export type PendingTest = typeof PendingTest.Type

export const Rpc = define({
  id: "buff.chat-plugin",
  methods: {
    list: { input: Nothing, output: portable(Schema.Struct({ plugins: Schema.Array(Entry) })) },
    /** Страница отрисовщика как она лежит в папке; рамку вокруг неё собирает клиент. */
    view: {
      input: portable(Target),
      output: portable(Schema.Struct({ html: Schema.String, version: Schema.String })),
      errors: Failures,
    },
    /** Содержимое примера блока. */
    example: {
      input: portable(Schema.Struct({ id: Schema.String, name: Schema.String })),
      output: portable(Schema.Struct({ block: Schema.String, text: Schema.String })),
      errors: Failures,
    },
    /** Включить или выключить любой плагин — папка остаётся на месте. */
    enable: {
      input: portable(Schema.Struct({ id: Schema.String, enabled: Schema.Boolean })),
      output: Nothing,
      errors: Failures,
    },
    /** Удалить свой плагин с диска; встроенные только выключаются. */
    remove: { input: portable(Target), output: Nothing, errors: Failures },
    /** Сценарий текста для консоли (`text.js`): консоль исполняет его сама, в отдельном контексте. */
    script: {
      input: portable(Target),
      output: portable(Schema.Struct({ js: Schema.String, version: Schema.String })),
      errors: Failures,
    },
    /** Живые проверки чата, которых ещё ждут: для клиентов без живых событий вызова. */
    tests: {
      input: portable(Schema.Struct({ session: Schema.String })),
      output: portable(Schema.Struct({ tests: Schema.Array(PendingTest) })),
      errors: Failures,
    },
    /** Клиент о живой проверке: пример нарисован (и какой высоты) или упал с ошибкой. */
    report: {
      input: portable(
        Schema.Struct({
          session: Schema.String,
          call: Schema.String,
          example: Schema.String,
          ok: Schema.Boolean,
          error: Schema.optional(Schema.String),
          height: Schema.optional(Schema.Finite),
        }),
      ),
      output: Nothing,
    },
    /**
     * What a visual wants the model to know with the person's next message: its state after
     * they clicked in it. `frame` names the visual within the chat; no text clears it.
     */
    context: {
      input: portable(
        Schema.Struct({
          session: Schema.String,
          frame: Schema.String,
          id: Schema.String,
          text: Schema.optional(Schema.String),
        }),
      ),
      output: Nothing,
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

/** Инструменты режима «Настройка»: модель сама создаёт, проверяет и убирает плагины. */
export const TOOLS = {
  guide: "chat_plugin_guide",
  list: "chat_plugin_list",
  save: "chat_plugin_save",
  test: "chat_plugin_test",
  remove: "chat_plugin_remove",
} as const

/** Действия в запросе разрешения: сохранение и удаление человек подтверждает всегда. */
export const SAVE_ACTION = "buff_chat_plugin_save"
export const REMOVE_ACTION = "buff_chat_plugin_remove"

/** Под этим ключом в метаданных идущего вызова `chat_plugin_test` лежит задание клиенту. */
export const TEST_KEY = "pluginTest"

/** Живая проверка: клиент рисует примеры плагина и сообщает, что вышло (`report`). */
export const Test = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  name: Schema.String,
  examples: Schema.Array(Schema.Struct({ name: Schema.String, block: Schema.String, text: Schema.String })),
})
export type Test = typeof Test.Type

/** Что клиент увидел, нарисовав пример. */
export type TestResult =
  | { readonly ok: true; readonly height?: number }
  | { readonly ok: false; readonly error: string }

// --- проверка -------------------------------------------------------------------------------

export function idProblem(id: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  return /^[a-z0-9][a-z0-9-]*$/.test(id)
    ? undefined
    : t("The ID is lowercase Latin letters, digits and hyphen, for example sales-map.")
}

/** Имя блока становится языком блока кода в ответе модели. */
export function blockProblem(block: string, t: BuffI18n.T = BuffI18n.english): string | undefined {
  return /^[a-z][a-z0-9_-]*$/.test(block)
    ? undefined
    : t("A block name is one lowercase word of Latin letters, digits, hyphen or underscore, for example sales-map.")
}

/** Описание плагина из текста `plugin.json` либо причина, почему оно не годится. */
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

/** Подписи по языкам из описания плагина: только строки, только при языке, написанном как язык. */
function labelsOf(value: unknown): Record<string, Label> | undefined {
  if (!isRecord(value)) return undefined
  const found: Record<string, Label> = {}
  for (const [locale, raw] of Object.entries(value)) {
    if (!LOCALE.test(locale) || !isRecord(raw)) continue
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, LIMITS.labelChars) : ""
    const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, LIMITS.labelChars) : ""
    if (name || summary) found[locale] = { ...(name ? { name } : {}), ...(summary ? { summary } : {}) }
  }
  return Object.keys(found).length ? found : undefined
}

/**
 * Плагин, как его показывают человеку на его языке: имя и строка «что это» из подписей —
 * точного языка («pt-BR»), затем его основы («pt»); чего нет — остаётся как в описании.
 */
export function localized<T extends { name: string; description: string; labels?: Readonly<Record<string, Label>> | undefined }>(
  entry: T,
  locale: string,
): T {
  const label = entry.labels?.[locale] ?? entry.labels?.[locale.split("-")[0] ?? ""]
  if (!label) return entry
  return { ...entry, name: label.name ?? entry.name, description: label.summary ?? entry.description }
}

export function manifestOf(
  text: string,
  t: BuffI18n.T = BuffI18n.english,
): { readonly manifest: Manifest } | { readonly problem: string } {
  const parsed = parse(text)
  if (!isRecord(parsed)) return { problem: t("The plugin description is not a JSON object.") }
  const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
  const description = typeof parsed.description === "string" ? parsed.description.trim() : ""
  if (!name) return { problem: t("The plugin has no name.") }
  if (!description) return { problem: t("Describe when the plugin is needed: the model decides by the description.") }
  if (description.length > LIMITS.descriptionChars)
    return {
      problem: t("The description is always in the model's prompt: keep it within {size} characters.", {
        size: LIMITS.descriptionChars,
      }),
    }
  const listed = Array.isArray(parsed.blocks) ? parsed.blocks : []
  const blocks = [...new Set(listed.map((block) => (typeof block === "string" ? block : "")))]
  if (!blocks.length) return { problem: t("The plugin names no block to draw.") }
  const bad = blocks.map((block) => blockProblem(block, t)).find((problem) => problem !== undefined)
  if (bad) return { problem: bad }
  const height =
    typeof parsed.height === "number" && parsed.height >= 40 && parsed.height <= 720
      ? Math.round(parsed.height)
      : undefined
  const labels = labelsOf(parsed.labels)
  return {
    manifest: { name, description, ...(labels ? { labels } : {}), blocks, ...(height === undefined ? {} : { height }) },
  }
}

// --- плагин от модели -----------------------------------------------------------------------

/** Что модель передаёт, сохраняя плагин: всё содержимое папки. */
export interface SaveInput {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly blocks: readonly string[]
  readonly view: string
  readonly guide: string
  /** Необязательный текст для консоли; пусто — его нет. */
  readonly text: string
  readonly examples: readonly { readonly name: string; readonly block: string }[]
  /** Справочники к инструкции — для большого плагина; обычно пусто. */
  readonly references?: readonly { readonly name: string; readonly text: string }[]
}

/** Файлы папки плагина из того, что передала модель, либо причина отказа — для модели, по-английски. */
export function folderOf(input: SaveInput): { readonly files: Record<string, string> } | { readonly problem: string } {
  const id = idProblem(input.id)
  if (id) return { problem: id }
  const manifest = { name: input.name.trim(), description: input.description.trim(), blocks: [...input.blocks] }
  const read = manifestOf(JSON.stringify(manifest))
  if ("problem" in read) return read
  if (!input.view.trim()) return { problem: "The view is empty: write the page that draws the block." }
  if (!input.guide.trim()) return { problem: "The guide is empty: write when to use the block and its format." }
  if (input.guide.length > LIMITS.guideChars)
    return {
      problem: `The guide is too long: keep it within ${LIMITS.guideChars} characters and move the details of each variant into references.`,
    }
  if (!input.examples.length)
    return { problem: "Give at least one example of the block: the plugin is tested by drawing it." }
  const files: Record<string, string> = {
    [FILES.manifest]: JSON.stringify(read.manifest, null, 2),
    [FILES.view]: input.view,
    [FILES.guide]: input.guide,
    ...(input.text.trim() ? { [FILES.text]: input.text } : {}),
  }
  for (const example of input.examples) {
    if (idProblem(example.name))
      return { problem: `An example's name is lowercase Latin letters, digits and hyphen: «${example.name}» is not.` }
    const fenced = exampleOf(example.block)
    if (!fenced)
      return {
        problem: `The example «${example.name}» must be one fenced code block, exactly as you would write it in a chat.`,
      }
    if (!read.manifest.blocks.includes(fenced.block))
      return {
        problem: `The example «${example.name}» is a «${fenced.block}» block, but the plugin draws: ${read.manifest.blocks.join(", ")}.`,
      }
    files[`${FILES.examples}/${example.name}.md`] = example.block
  }
  for (const reference of input.references ?? []) {
    if (idProblem(reference.name))
      return {
        problem: `A reference's name is lowercase Latin letters, digits and hyphen: «${reference.name}» is not.`,
      }
    if (!reference.text.trim()) return { problem: `The reference «${reference.name}» is empty.` }
    if (!input.guide.includes(`${FILES.references}/${reference.name}.md`))
      return {
        problem: `The guide never points to ${FILES.references}/${reference.name}.md: say in the guide when to read it, or drop the reference.`,
      }
    files[`${FILES.references}/${reference.name}.md`] = reference.text
  }
  return { files }
}

/** Строки запроса разрешения на сохранение — то, что человек подтверждает, на его языке. */
export function saveConfirmation(
  input: {
    readonly name: string
    readonly description: string
    readonly blocks: readonly string[]
    readonly scope: Scope
    /** Название проекта — для плагина «только в этом проекте». */
    readonly project?: string
  },
  t: BuffI18n.T,
): string[] {
  const where =
    input.scope === "local" && input.project
      ? t("only the project «{project}»", { project: input.project })
      : t("all projects")
  return [
    t("Save the chat plugin «{name}» for: {where}", { name: input.name.trim(), where }),
    t("Draws blocks: {blocks}", { blocks: input.blocks.join(", ") }),
    t("When it is needed: {description}", { description: input.description.trim() }),
  ]
}

const ADDRESS = /(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s"'`)<>]*/gi
/** Пространства имён самой разметки: строки-идентификаторы, по ним ничего не загружается. */
const NAMESPACE = /^https?:\/\/www\.w3\.org\//i

/**
 * Веб-адреса в странице отрисовщика. Сети у рамки нет, так что загрузить по ним ничего не
 * выйдет: автору (модели) об этом говорят до того, как пример «не нарисуется».
 */
export function webAddresses(view: string): string[] {
  return [...new Set(view.match(ADDRESS) ?? [])].filter((address) => !NAMESPACE.test(address))
}

// --- живая проверка -------------------------------------------------------------------------

/** Задание живой проверки из метаданных вызова; не оно — ничего. */
export function testOf(metadata: unknown): Test | undefined {
  if (!isRecord(metadata)) return undefined
  const result = Schema.decodeUnknownExit(Test)(metadata[TEST_KEY])
  return result._tag === "Success" ? result.value : undefined
}

/** Итог живой проверки для модели: что нарисовалось, что упало, о чём клиент промолчал. */
export function testText(examples: readonly string[], results: ReadonlyMap<string, TestResult>): string {
  const lines = examples.map((name) => {
    const result = results.get(name)
    if (!result) return `- ${name}: no answer`
    if (!result.ok) return `- ${name}: FAILED — ${result.error}`
    return `- ${name}: drawn${result.height === undefined ? "" : `, ${Math.round(result.height)} px high`}`
  })
  const failed = examples.some((name) => results.get(name)?.ok === false)
  const silent = examples.some((name) => !results.has(name))
  const verdict = failed
    ? "Fix the view (or the example) and run this test again. Do not tell the user the plugin works."
    : silent
      ? "The user's app did not confirm the drawing (it may be an older app, or the console). Do not claim it works: show one example block in your reply and ask the user whether they see the visual."
      : "All examples drew without an error. Now show one example block in your reply so the user sees the visual, and ask whether it looks right."
  return `Drawn in the user's app:\n${lines.join("\n")}\n\n${verdict}`
}

// --- примеры --------------------------------------------------------------------------------

/** Блок кода из файла примера: его имя и содержимое. Пример пишется так же, как блок в ответе. */
export function exampleOf(markdown: string): { readonly block: string; readonly text: string } | undefined {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => /^`{3,}\S/.test(line))
  if (start < 0) return undefined
  const fence = /^`+/.exec(lines[start]!)![0]
  const block = lines[start]!.slice(fence.length).trim().split(/\s+/)[0]!
  const closing = new RegExp("^`{" + fence.length + ",}\\s*$")
  const end = lines.findIndex((line, index) => index > start && closing.test(line))
  if (end < 0) return undefined
  return { block, text: lines.slice(start + 1, end).join("\n") }
}

// --- владельцы блоков -----------------------------------------------------------------------

const working = (entry: Entry) => entry.enabled && entry.problem === undefined

/**
 * Какой плагин рисует блок. Блок, названный двумя плагинами, достаётся встроенному, а среди
 * своих — первому по идентификатору: порядок не зависит от того, как папки прочитал диск.
 */
export function owners(entries: readonly Entry[]): Record<string, string> {
  const ranked = entries
    .filter(working)
    .toSorted((a, b) => Number(b.origin === "builtin") - Number(a.origin === "builtin") || a.id.localeCompare(b.id))
  const found: Record<string, string> = {}
  for (const entry of ranked) for (const block of entry.blocks) found[block] ??= entry.id
  return found
}

// --- плагин как навык -----------------------------------------------------------------------

/**
 * Плагин для модели — навык с визуализацией, и подгружается он так же, в три шага: в промпте
 * всегда только имя и описание (с именами блоков); инструкцию `GUIDE.md` модель загружает
 * сама, когда плагин понадобился; справочники `guide/*.md` читает по ссылкам из неё.
 * Библиотека из сотен плагинов поэтому стоит контексту по строке на плагин.
 */
export const SKILL_PREFIX = "visual-"

/** Идентификатор навыка плагина — им модель его загружает. */
export const skillId = (id: string) => SKILL_PREFIX + id

/** Плагин ли это: такие навыки в списке навыков человека не показываются — у них свой экран. */
export const isPluginSkill = (id: string) => id.startsWith(SKILL_PREFIX)

const ITEM = "---item---"
const HEADING = /^#{1,6}\s+(.*\S)\s*$/m

/** Справочники папки плагина: имя и заголовок — что в нём искать. */
export function referencesOf(files: Readonly<Record<string, string>>): { name: string; title: string }[] {
  const prefix = FILES.references + "/"
  return Object.keys(files)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".md"))
    .toSorted()
    .map((file) => {
      const name = file.slice(prefix.length, -3)
      return { name, title: HEADING.exec(files[file]!)?.[1] ?? name }
    })
}

/**
 * Навык плагина: описание для промпта и то, что модель получит, загрузив его, — инструкция и
 * перечень справочников с путями. `directory` — папка плагина на диске. Блоки, которые рисует
 * другой плагин (`owned`), в описание не попадают; не осталось ни одного — навыка нет.
 */
export function skillOf(input: {
  readonly entry: Entry
  readonly guide: string
  readonly directory: string
  readonly files: Readonly<Record<string, string>>
  readonly owned: Readonly<Record<string, string>>
  /** Шаблоны: описание навыка и приписка о справочниках (файлы роли). */
  readonly templates: { readonly description: string; readonly references: string }
}): { readonly id: string; readonly name: string; readonly description: string; readonly content: string } | undefined {
  const { entry } = input
  const blocks = entry.blocks.filter((block) => input.owned[block] === entry.id)
  if (!working(entry) || !blocks.length) return undefined
  const named = blocks.map((block) => "`" + block + "`").join(", ")
  const references = referencesOf(input.files)
  const [frame = "", item = ""] = input.templates.references.split(ITEM)
  const more = references.length
    ? "\n\n" +
      fill(frame.trim(), {
        items: references
          .map((reference) =>
            fill(item.trim(), {
              path: `${input.directory}/${FILES.references}/${reference.name}.md`,
              title: reference.title,
            }),
          )
          .join("\n"),
      })
    : ""
  return {
    id: skillId(entry.id),
    name: entry.name,
    description: fill(input.templates.description.trim(), { description: entry.description, blocks: named }),
    content: input.guide.trim() + more,
  }
}

/**
 * Часть системного промпта о том, что человек выставил в визуализациях чата; шаблон устроен
 * как у `systemText`. Без записей её нет.
 */
export function contextText(
  template: string,
  states: readonly { readonly plugin: string; readonly text: string }[],
): string | undefined {
  if (!states.length) return undefined
  const [frame = "", item = ""] = template.split(ITEM)
  return fill(frame.trim(), {
    items: states.map((state) => fill(item.trim(), { plugin: state.plugin, text: state.text.trim() })).join("\n"),
  })
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole)
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
