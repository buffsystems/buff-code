export * as BuffToolTitles from "./buff-tool-titles.js"

/**
 * Названия инструментов Buff в ленте (#470): у инструментов апстрима они человеческие («Чтение»,
 * «Оболочка»), наши без этого показывались именами для модели («workflow_create»). Здесь —
 * английские названия; экран переводит их по каталогу.
 */

const TITLES: Readonly<Record<string, string>> = {
  workflow_guide: "Workflow guide",
  workflow_saved: "Saved workflows",
  workflow_eval: "Workflow check",
  workflow_create: "Start a workflow",
  workflow_run: "Run a saved workflow",
  workflow_runs: "Workflow runs",
  workflow_result: "Workflow result",
  workflow_resume: "Resume a workflow",
  workflow_amend: "Change a workflow",
  workflow_save: "Save a workflow",
  workflow_question: "Ask the person",
  workflow_answer: "Answer a workflow",
  automation_create: "New automation",
  todo_update: "To-do list",
  plan_exit: "Plan",
  knowledge_read_entry: "Knowledge base: entry",
  knowledge_write_entry: "Knowledge base: write",
  knowledge_list_entries: "Knowledge base: list",
  repos_read: "Repositories: read",
  repos_glob: "Repositories: files",
  repos_grep: "Repositories: search",
}

/** Название инструмента Buff по его имени; чужой инструмент — без названия. */
export function of(name: string): string | undefined {
  return TITLES[name]
}

export function all(): readonly string[] {
  return Object.values(TITLES)
}
