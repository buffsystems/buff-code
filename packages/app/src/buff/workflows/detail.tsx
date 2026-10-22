import { createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { TextField } from "@opencode/ui/text-field"
import { useBuffText } from "../i18n"
import { Choice, FormBody, Hint, Problem } from "../settings-kit"
import { formOf, metaOf, type Form } from "./meta-form"

/**
 * Сохранённый сценарий (#448): описание, «когда применять» и аргументы правятся здесь; сам
 * скрипт — только для чтения: его пишет и правит агент в чате («Исправить в чате»).
 */

const REQUIRED = [
  { value: "no", label: "Optional" },
  { value: "yes", label: "Required" },
] as const

export function WorkflowDetail(props: {
  meta: BuffWorkflowFile.Meta
  script: string
  path: string
  onSave: (meta: BuffWorkflowFile.Meta) => Promise<string | undefined>
  onStart: () => void
  onFixInChat: () => void
  onRemove: () => void
}) {
  const dialog = useDialog()
  const { t } = useBuffText()
  const required = () => REQUIRED.map((option) => ({ ...option, label: t(option.label) }))
  const [form, setForm] = createStore<Form>(formOf(props.meta))
  const [problems, setProblems] = createSignal<Readonly<Record<string, string>>>({})
  const [problem, setProblem] = createSignal<string>()
  const [saved, setSaved] = createSignal(false)
  const args = () => Object.entries(props.meta.args)

  const save = async () => {
    setSaved(false)
    const next = metaOf(props.meta, form)
    if ("problems" in next) return setProblems(next.problems)
    setProblems({})
    const refusal = await props.onSave(next.meta)
    setProblem(refusal)
    setSaved(!refusal)
  }
  const leave = (then: () => void) => () => {
    dialog.close()
    then()
  }

  return (
    <Dialog size="x-large">
      <DialogHeader>
        <DialogTitle>{t("Workflow «{name}»", { name: BuffWorkflowFile.displayName(props.meta) })}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FormBody name="buff-workflow-detail">
          <TextField label={t("Title")} value={form.title} onChange={(value) => setForm("title", value)} />
          <TextField
            label={t("What it does")}
            multiline
            value={form.description}
            onChange={(value) => setForm("description", value)}
          />
          <TextField
            label={t("When to use")}
            multiline
            value={form.whenToUse}
            onChange={(value) => setForm("whenToUse", value)}
          />
          <Hint>
            {t(
              "The agent reads this when it picks a saved workflow — write for someone who has not seen the conversation.",
            )}
          </Hint>
          <div class="buff-wf-field">
            <span class="buff-wf-label">{t("Arguments")}</span>
            <Show when={args().length} fallback={<Hint>{t("No arguments.")}</Hint>}>
              <For each={args()}>
                {([name, decl]) => (
                  <div class="buff-wf-arg" data-arg={name}>
                    <span class="buff-wf-arg-name">
                      {name} · {t(BuffWorkflowFlow.TYPE_LABEL[decl.type])}
                    </span>
                    <TextField
                      label={t("Description")}
                      value={form.args[name]?.description ?? ""}
                      onChange={(value) => setForm("args", name, "description", value)}
                    />
                    <TextField
                      label={t("Default")}
                      value={form.args[name]?.default ?? ""}
                      onChange={(value) => setForm("args", name, "default", value)}
                    />
                    <Choice
                      value={form.args[name]?.required ? "yes" : "no"}
                      options={required()}
                      onPick={(value) => setForm("args", name, "required", value === "yes")}
                    />
                    <Problem text={problems()[name] && t(problems()[name]!)} />
                  </div>
                )}
              </For>
            </Show>
            <Hint>{t("New arguments and their types are changed by the agent together with the script.")}</Hint>
          </div>
          <div class="buff-wf-field">
            <span class="buff-wf-label">{t("Script · read-only")}</span>
            <pre class="buff-wf-pre buff-wf-script" data-slot="buff-wf-script">
              {props.script}
            </pre>
            <Hint>{props.path}</Hint>
          </div>
          <Problem text={problem() && t(problem()!)} />
          <Show when={saved()}>
            <Hint>{t("Saved.")}</Hint>
          </Show>
        </FormBody>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" data-action="buff-wf-remove" onClick={leave(props.onRemove)}>
          {t("Delete")}
        </Button>
        <Button variant="ghost" data-action="buff-wf-fix-saved" onClick={leave(props.onFixInChat)}>
          {t("Fix in chat")}
        </Button>
        <Button variant="neutral" data-action="buff-wf-detail-start" onClick={leave(props.onStart)}>
          {t("Run")}
        </Button>
        <Button variant="contrast" data-action="buff-wf-save-meta" onClick={() => void save()}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
