/**
 * Последняя вкладка настроек (#460): Ctrl+, открывает настройки там, где их закрыли. Хранится
 * у этого окна — удобство одного человека, без хранилища просто «Общие».
 */
const KEY = "buff.settings.last-tab"

export function rememberSettingsTab(tab: string): void {
  try {
    localStorage.setItem(KEY, tab)
  } catch {
    // Без хранилища настройки откроются на «Общих».
  }
}

export function lastSettingsTab<Tab extends string>(tabs: readonly Tab[]): Tab {
  try {
    const stored = localStorage.getItem(KEY)
    return tabs.find((tab) => tab === stored) ?? ("general" as Tab)
  } catch {
    return "general" as Tab
  }
}
