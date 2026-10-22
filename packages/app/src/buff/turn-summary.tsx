import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { BuffTurn } from "@opencode/schema/buff-turn"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useBuffText } from "./i18n"
import "./turn-summary.css"

/**
 * Сводка изменений хода и откат с проверкой (#449). Под ответом — какие файлы ход изменил; по
 * файлу открывается панель изменений. Откат больше не молчит: перед ним показано, какие файлы
 * вернутся, и отмечены те, что кто-то менял уже после хода, — их правки откат затрёт. После
 * отката над полем ввода остаётся строка с возвратом «как было».
 */

function FileRow(props: { file: BuffTurn.File; onOpen?: (path: string) => void }) {
  const { t } = useBuffText()
  return (
    <button
      type="button"
      class="buff-turn-file"
      data-external={props.file.external}
      disabled={!props.onOpen}
      onClick={() => props.onOpen?.(props.file.file)}
    >
      <span class="min-w-0 flex-1 truncate font-mono text-12-regular text-text-base">{props.file.file}</span>
      <Show when={props.file.external}>
        <span class="buff-turn-external">{t("changed after the turn")}</span>
      </Show>
      <span class="shrink-0 text-12-regular text-text-weak">{BuffTurn.fileNote(props.file, t)}</span>
    </button>
  )
}

/** Строка под ответом: сколько файлов ход изменил; раскрывается в список. */
export function BuffTurnSummary(props: {
  sessionID: string
  userMessageID: string
  onOpenFile: (path: string) => void
  onRevert: () => void
}) {
  const sdk = useServerSDK()
  const { t, n } = useBuffText()
  const [open, setOpen] = createSignal(false)
  const [files] = createResource(
    () => ({ sessionID: props.sessionID, from: props.userMessageID }),
    (input) =>
      sdk.api.session.diff({ ...input, context: 0 }).then(
        (diffs) => diffs.map((diff): BuffTurn.File => ({ ...diff, external: false })),
        () => [] as BuffTurn.File[],
      ),
    { initialValue: [] },
  )
  const line = createMemo(() => BuffTurn.changedLine(files.latest ?? [], n))
  return (
    <Show when={line()}>
      {(text) => (
        <div class="buff-turn-summary" data-component="buff-turn-summary">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="buff-turn-toggle"
              data-action="buff-turn-toggle"
              onClick={() => setOpen(!open())}
            >
              <Icon name={open() ? "chevron-down" : "chevron-right"} class="shrink-0" />
              <span>{text()}</span>
            </button>
            <Button size="small" variant="ghost" data-action="buff-turn-revert" onClick={props.onRevert}>
              {t("Rewind the turn")}
            </Button>
          </div>
          <Show when={open()}>
            <div class="buff-turn-files">
              <For each={files.latest}>{(file) => <FileRow file={file} onOpen={props.onOpenFile} />}</For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}

type Choice = { files: boolean } | undefined

function RevertDialog(props: { preview: BuffTurn.Preview; problem?: string; onChoice: (choice: Choice) => void }) {
  const dialog = useDialog()
  const { t, n } = useBuffText()
  const verdict = () => BuffTurn.verdict(props.preview, t, n)
  const choose = (choice: Choice) => {
    props.onChoice(choice)
    dialog.close()
  }
  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{props.problem ? t("Rewind the turn?") : verdict().title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="buff-kit-form" data-component="buff-turn-revert" data-safe={verdict().safe}>
          <span class="text-13-regular text-text-base">
            {props.problem
              ? t("Could not check which files come back: {problem} The rewind is still possible.", { problem: props.problem })
              : verdict().text}
          </span>
          <Show when={props.preview.files.length > 0}>
            <div class="buff-turn-files">
              <For each={props.preview.files}>{(file) => <FileRow file={file} />}</For>
            </div>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => choose(undefined)}>
          {t("Cancel")}
        </Button>
        <Show when={props.preview.files.length > 0}>
          <Button variant="neutral" data-action="buff-turn-revert-chat" onClick={() => choose({ files: false })}>
            {t("Only the conversation")}
          </Button>
        </Show>
        <Button
          variant={verdict().safe ? "contrast" : "danger"}
          data-action="buff-turn-revert-confirm"
          onClick={() => choose({ files: true })}
        >
          {verdict().safe ? t("Rewind") : t("Rewind and overwrite the edits")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** Спросить перед откатом: что вернётся и трогать ли файлы; `undefined` — человек передумал. */
export function createRevertConfirm(input: { sessionID: () => string | undefined; directory: () => string }) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const rpc = useServerSDK().api.rpc(BuffTurn.Rpc)
  return async (message: { id: string }): Promise<Choice> => {
    const sessionID = input.sessionID()
    if (!sessionID) return undefined
    let problem: string | undefined
    const preview = await rpc
      .preview({ sessionID, messageID: message.id }, { location: { directory: input.directory() } })
      .catch((error: unknown) => {
        problem = formatServerError(error, undefined, t("the service did not answer."))
        return { snapshots: true, files: [] } satisfies BuffTurn.Preview
      })
    return new Promise<Choice>((resolve) => {
      let settled = false
      const settle = (choice: Choice) => {
        if (settled) return
        settled = true
        resolve(choice)
      }
      void dialog.show(
        () => <RevertDialog preview={preview} problem={problem} onChoice={settle} />,
        () => settle(undefined),
      )
    })
  }
}

/** Строка над полем ввода после отката: что вернулось и как вернуть «как было». */
export function BuffRevertedStrip(props: { files: number | undefined; onRedo: () => void }) {
  const { t, n } = useBuffText()
  return (
    <Show when={props.files !== undefined}>
      <div class="buff-turn-reverted" data-component="buff-turn-reverted">
        <Icon name="arrow-left" class="shrink-0" />
        <span class="min-w-0 flex-1 text-13-regular text-text-base">
          {BuffTurn.revertedLine(props.files ?? 0, t, n)} {t("Send a new message and the rewind becomes final.")}
        </span>
        <Button size="small" variant="neutral" data-action="buff-turn-redo" onClick={props.onRedo}>
          {t("Bring it back")}
        </Button>
      </div>
    </Show>
  )
}
