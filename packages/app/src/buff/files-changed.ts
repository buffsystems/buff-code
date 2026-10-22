/**
 * Могли ли после события измениться файлы проекта (#470). Наблюдатель файлов говорит не обо всём:
 * он следит за верхним уровнем каталога, а откат хода переписывает файлы из снимка. Поэтому
 * панель изменений и чип Git перечитываются и по событиям хода — инструмент отработал, команда
 * оболочки закончилась, ход окончен, откат применён или отменён.
 */
const AFTER = new Set(["filesystem.changed", "session.tool.success", "session.shell.ended", "session.idle"])

export function filesMayHaveChanged(type: string): boolean {
  return AFTER.has(type) || type.startsWith("session.revert.")
}
