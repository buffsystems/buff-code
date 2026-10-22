/**
 * Чтение вывода фоновой команды (#456) — целиком: страница за страницей от курсора, пока не
 * догонит записанное. Окно вывода зовёт его раз в секунду, пока команда идёт.
 */
export type ShellPage = { readonly output: string; readonly cursor: number; readonly size: number }

export async function readShellOutput(
  load: (cursor: number) => Promise<ShellPage>,
  from: number,
): Promise<{ output: string; cursor: number }> {
  let cursor = from
  let output = ""
  while (true) {
    const page = await load(cursor)
    if (page.cursor <= cursor) break
    output += page.output
    cursor = page.cursor
    if (cursor >= page.size) break
  }
  return { output, cursor }
}
