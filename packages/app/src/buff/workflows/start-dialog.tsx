import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import type { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Select } from "@opencode/ui/select"
import { TextField } from "@opencode/ui/text-field"
import { useBuffText } from "../i18n"
import { Choice, FormBody, Hint, Problem } from "../settings-kit"
import type { Started } from "./controller"

/**
 * Запуск сохранённого сценария (#448): поле на каждый аргумент по его типу — строка, число,
 * да/нет, JSON — с умолчанием и ошибкой под полем, и проект, в котором он пойдёт. Прогон идёт
 * в новой сессии проекта; итог приходит туда.
 */

const BOOLEAN = [
  { value: "", label: "Not set" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
] as const

export function StartDialog(props: {
  meta: BuffWorkflowFile.Meta
  directories: readonly string[]
  onStart: (args: Record<string, unknown>, directory: string) => Promise<Started>
  onStarted: (run: string) => void
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const boolean = () => BOOLEAN.map((option) => ({ ...option, label: t(option.label) }))
  const [texts, setTexts] = createStore<Record<string, string>>(BuffWorkflowFlow.formTexts(props.meta.args))
  const [problems, setProblems] = createSignal<Readonly<Record<string, string>>>({})
  const [problem, setProblem] = createSignal<string>()
  const [directory, setDirectory] = createSignal(props.directories[0] ?? "")
  const args = () => Object.entries(props.meta.args)

  const start = async () => {
    setProblem(undefined)
    const checked = BuffWorkflowFlow.formValues(props.meta.args, texts)
    if ("problems" in checked) return setProblems(checked.problems)
    setProblems({})
    if (!directory()) return setProblem(t("Choose a project."))
    const started = await props.onStart({ ...checked.values }, directory())
    if (started.problems) return setProblems(started.problems)
    if (!started.run) return setProblem(started.problem ?? t("The workflow did not start."))
    dialog.close()
    props.onStarted(started.run)
  }

  return (
    <Dialog size="large">
      <DialogHeader>
        <DialogTitle>{t("Run «{name}»", { name: props.meta.name })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-workflow-start">
          <Hint>{props.meta.description}</Hint>
          <Show when={!args().length}>
            <Hint>{t("The workflow has no arguments.")}</Hint>
          </Show>
          <For each={args()}>
            {([name, decl]) => (
              <div class="buff-wf-field" data-arg={name}>
                <span class="buff-wf-label">
                  {name} · {t(BuffWorkflowFlow.TYPE_LABEL[decl.type])}
                  {decl.required ? ` · ${t("required")}` : ""}
                </span>
                <Show
                  when={decl.type === "boolean"}
                  fallback={
                    <TextField
                      label={decl.description ?? name}
                      multiline={decl.type === "json"}
                      placeholder={decl.type === "json" ? t('{"key": "value"}') : ""}
                      value={texts[name] ?? ""}
                      onChange={(value) => setTexts(name, value)}
                    />
                  }
                >
                  <Hint>{decl.description}</Hint>
                  <Choice
                    value={(texts[name] ?? "") as "" | "true" | "false"}
                    options={boolean()}
                    onPick={(value) => setTexts(name, value)}
                  />
                </Show>
                <Problem text={problems()[name] && t(problems()[name]!)} />
              </div>
            )}
          </For>
          <div class="buff-wf-field">
            <span class="buff-wf-label">{t("Project")}</span>
            <Select
              data-action="buff-workflow-project"
              options={[...props.directories]}
              current={directory()}
              value={(item) => item}
              label={(item) => item}
              onSelect={(item) => item && setDirectory(item)}
            />
            <Hint>
              {t("The run goes into a new session of this project; subagents work in it with the usual tools.")}
            </Hint>
          </div>
          <Problem text={problem()} />
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="neutral" onClick={() => dialog.close()}>
          {t("Cancel")}
        </Button>
        <Button variant="contrast" data-action="buff-workflow-start" onClick={() => void start()}>
          {t("Run")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
