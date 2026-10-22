/**
 * Списки настроек Buff (#445, #446): поиск и группы по происхождению. Группы идут в заданном
 * порядке; та, в которую здесь можно добавлять, видна и пустой — чтобы было понятно, куда
 * попадёт новое. При поиске пустые группы пропадают.
 */
export interface OriginGroup<Entry extends { readonly scope: string }> {
  readonly scope: Entry["scope"]
  readonly items: readonly Entry[]
}

export function originGroups<Entry extends { readonly scope: string }>(
  entries: readonly Entry[],
  query: string,
  /** Какие происхождения показывать и в каком порядке. */
  order: readonly Entry["scope"][],
  /** В какие из них здесь можно добавлять. */
  editable: readonly Entry["scope"][],
  /** По какому тексту записи искать. */
  text: (entry: Entry) => readonly string[],
): OriginGroup<Entry>[] {
  const needle = query.trim().toLowerCase()
  const found = needle
    ? entries.filter((entry) => text(entry).some((part) => part.toLowerCase().includes(needle)))
    : entries
  return order
    .map((scope) => ({ scope, items: found.filter((entry) => entry.scope === scope) }))
    .filter((group) => group.items.length > 0 || (!needle && editable.includes(group.scope)))
}
