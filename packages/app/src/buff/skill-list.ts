import type { BuffSkill } from "@opencode/schema/buff-skill"
import { originGroups } from "./origin-groups"

/**
 * Список навыков в настройках (#445): поиск по идентификатору, названию и описанию и группы
 * по происхождению — сначала те, что правятся здесь, затем подключённые и встроенные.
 */
export interface SkillGroup {
  readonly scope: BuffSkill.Origin
  readonly skills: readonly BuffSkill.Entry[]
}

const READ_ONLY: readonly BuffSkill.Origin[] = ["external", "builtin"]

export function skillGroups(
  entries: readonly BuffSkill.Entry[],
  query: string,
  /** Области, в которые здесь можно добавлять. */
  scopes: readonly BuffSkill.Scope[],
): SkillGroup[] {
  return originGroups(entries, query, [...scopes, ...READ_ONLY], scopes, (entry) => [
    entry.id,
    entry.name,
    entry.description ?? "",
  ]).map((group) => ({ scope: group.scope, skills: group.items }))
}
