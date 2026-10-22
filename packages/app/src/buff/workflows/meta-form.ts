import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"

/**
 * Правка сохранённого сценария в окне (#448): название (#470), описание, «когда применять» и у каждого
 * аргумента — описание, обязательность и умолчание. Типы и тело скрипта меняет только модель.
 */

/** Поля формы изменяемы: их правит хранилище формы окна. */
export interface ArgForm {
  description: string
  required: boolean
  default: string
}
export interface Form {
  title: string
  description: string
  whenToUse: string
  args: Record<string, ArgForm>
}

const asText = (value: unknown) =>
  value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)

export function formOf(meta: BuffWorkflowFile.Meta): Form {
  return {
    title: meta.title ?? "",
    description: meta.description,
    whenToUse: meta.whenToUse ?? "",
    args: Object.fromEntries(
      Object.entries(meta.args).map(([name, decl]) => [
        name,
        { description: decl.description ?? "", required: decl.required ?? false, default: asText(decl.default) },
      ]),
    ),
  }
}

export function metaOf(
  meta: BuffWorkflowFile.Meta,
  form: Form,
): { readonly meta: BuffWorkflowFile.Meta } | { readonly problems: Readonly<Record<string, string>> } {
  const problems: Record<string, string> = {}
  const args: Record<string, BuffWorkflowFile.ArgDecl> = {}
  for (const [name, decl] of Object.entries(meta.args)) {
    const edit = form.args[name] ?? { description: "", required: false, default: "" }
    const parsed = BuffWorkflowFile.fromText(decl, edit.default)
    if (parsed.problem) problems[name] = parsed.problem
    args[name] = {
      type: decl.type,
      ...(edit.description.trim() ? { description: edit.description.trim() } : {}),
      ...(edit.required ? { required: true } : {}),
      ...(parsed.value === undefined ? {} : { default: parsed.value }),
    }
  }
  if (Object.keys(problems).length) return { problems }
  return {
    meta: {
      name: meta.name,
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      description: form.description.trim(),
      ...(form.whenToUse.trim() ? { whenToUse: form.whenToUse.trim() } : {}),
      args,
    },
  }
}
