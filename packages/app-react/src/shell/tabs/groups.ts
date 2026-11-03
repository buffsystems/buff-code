// The open tabs by project for the vertical sidebar (#744): a folding group per project, in the
// order of each project's first tab; tabs whose project is not known yet stay plain rows on top.
// Pure: the strip hands in what it knows of each tab's directory.

import { tabKey, type Tab } from "./tabs"

export type TabGroup = { key: string; server: string; directory: string | undefined; tabs: Tab[] }

export const groupKey = (server: string, directory: string | undefined) => `${server}\n${directory ?? ""}`

/** A draft's session will live in its worktree when it has one; a session tab's directory is remembered. */
export function groupTabs(list: readonly Tab[], directoryOf: (tab: Tab) => string | undefined): TabGroup[] {
  const groups = new Map<string, TabGroup>()
  for (const tab of list) {
    const directory = tab.type === "draft" ? (tab.worktree ?? tab.directory) : directoryOf(tab)
    const key = groupKey(tab.server, directory)
    const group = groups.get(key) ?? { key, server: tab.server, directory, tabs: [] }
    group.tabs.push(tab)
    groups.set(key, group)
  }
  const all = [...groups.values()]
  return [
    ...all.filter((group) => group.directory === undefined),
    ...all.filter((group) => group.directory !== undefined),
  ]
}

/** The group a tab is shown in. */
export function groupOf(groups: readonly TabGroup[], key: string): TabGroup | undefined {
  return groups.find((group) => group.tabs.some((tab) => tabKey(tab) === key))
}

/**
 * The tabs in the order shown: a folded group's tabs are skipped — the keyboard walks what is on
 * screen — except the current one, which is never lost.
 */
export function shownOrder(
  groups: readonly TabGroup[],
  folded: ReadonlySet<string>,
  current: string | undefined,
  visible: (tab: Tab) => boolean,
): string[] {
  return groups.flatMap((group) =>
    group.tabs
      .filter((tab) => visible(tab))
      .map(tabKey)
      .filter((key) => !folded.has(group.key) || key === current),
  )
}
