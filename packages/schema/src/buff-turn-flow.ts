export * as BuffTurnFlow from "./buff-turn-flow.js"

import { BuffI18n } from "./buff-i18n.js"
import type { Ui } from "./buff-mcp-flow.js"
import { BuffTurn } from "./buff-turn.js"

/**
 * Откат в консоли (#449): перед откатом человек видит, какие файлы вернутся; если часть из них
 * кто-то менял уже после хода — выбирает, затирать ли эти правки. Диалоги приходят снаружи;
 * `undefined` — человек передумал.
 */

const fileLine = (file: BuffTurn.File, t: BuffI18n.T) =>
  `  ${file.file}  ${BuffTurn.fileNote(file, t)}${file.external ? `  ${t("← changed after the turn")}` : ""}`

export async function confirm(
  ui: Ui,
  preview: BuffTurn.Preview,
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): Promise<{ files: boolean } | undefined> {
  const verdict = BuffTurn.verdict(preview, t, n)
  const sure = await ui.confirm({
    title: verdict.title,
    message: [verdict.text, ...(preview.files.length ? ["", ...preview.files.map((file) => fileLine(file, t))] : [])].join("\n"),
  })
  if (!sure) return undefined
  if (verdict.safe) return { files: true }
  const what = await ui.select<"chat" | "files">({
    title: t("What to rewind"),
    options: [
      { title: t("Only the conversation"), value: "chat", description: t("the files stay as they are") },
      {
        title: t("The conversation and the files"),
        value: "files",
        description: t("edits made after the turn will be lost"),
      },
    ],
  })
  return what ? { files: what === "files" } : undefined
}

/** Строка под ответом в консоли: что ход изменил и чем это вернуть. */
export function footer(
  files: readonly Pick<BuffTurn.File, "additions" | "deletions">[],
  t: BuffI18n.T = BuffI18n.english,
  n: BuffI18n.N = BuffI18n.englishPlural,
): string | undefined {
  const line = BuffTurn.changedLine(files, n)
  return line ? `${line} · ${t("/undo — rewind")}` : undefined
}
