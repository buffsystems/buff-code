// A saved workflow (#448), ported from the Solid window's buff/workflows/detail.tsx: the title,
// description, «when to use» and the arguments are edited here; the script itself is read-only —
// the agent writes and edits it in the chat («Fix in chat»).

import { Button, Dialog, DialogBody, DialogFooter, Field, Input, Panel, Segmented, Textarea } from "@buff/ui/react"
import { formOf, metaOf, type Form } from "@opencode/app/react-reuse/workflow-meta-form"
import { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { useState } from "react"
import { useI18n } from "../i18n/provider"

export function WorkflowDetail(props: {
  meta: BuffWorkflowFile.Meta
  script: string
  path: string
  onClose: () => void
  onSave: (meta: BuffWorkflowFile.Meta) => Promise<string | undefined>
  onStart: () => void
  onFixInChat: () => void
  onRemove: () => void
}) {
  const t = useI18n().buff.t
  const [form, setForm] = useState<Form>(() => formOf(props.meta))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [problem, setProblem] = useState<string>()
  const [saved, setSaved] = useState(false)
  const edit = (patch: Partial<Form>) => setForm((current) => ({ ...current, ...patch }))
  const editArg = (name: string, patch: Partial<Form["args"][string]>) =>
    setForm((current) => {
      const arg = current.args[name] ?? { description: "", required: false, default: "" }
      return { ...current, args: { ...current.args, [name]: { ...arg, ...patch } } }
    })
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
    props.onClose()
    then()
  }
  const args = Object.entries(props.meta.args)

  return (
    <Dialog
      open
      size="xl"
      onOpenChange={(open) => !open && props.onClose()}
      title={t("Workflow «{name}»", { name: BuffWorkflowFile.displayName(props.meta) })}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="buff-workflow-detail">
          <Field label={t("Title")}>
            <Input value={form.title} onChange={(event) => edit({ title: event.currentTarget.value })} />
          </Field>
          <Field label={t("What it does")}>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(event) => edit({ description: event.currentTarget.value })}
            />
          </Field>
          <Field
            label={t("When to use")}
            hint={t(
              "The agent reads this when it picks a saved workflow — write for someone who has not seen the conversation.",
            )}
          >
            <Textarea
              rows={3}
              value={form.whenToUse}
              onChange={(event) => edit({ whenToUse: event.currentTarget.value })}
            />
          </Field>
          <Field
            label={t("Arguments")}
            group
            hint={t("New arguments and their types are changed by the agent together with the script.")}
          >
            {!args.length && <span className="ui-hint">{t("No arguments.")}</span>}
            {args.map(([name, decl]) => (
              <Panel inset key={name} className="buff-wf-arg" data-arg={name}>
                <span className="ui-title ui-title--sm">
                  {name} · {t(BuffWorkflowFlow.TYPE_LABEL[decl.type])}
                </span>
                <Field label={t("Description")}>
                  <Input
                    value={form.args[name]?.description ?? ""}
                    onChange={(event) => editArg(name, { description: event.currentTarget.value })}
                  />
                </Field>
                <Field label={t("Default")}>
                  <Input
                    value={form.args[name]?.default ?? ""}
                    onChange={(event) => editArg(name, { default: event.currentTarget.value })}
                  />
                </Field>
                <Segmented
                  size="sm"
                  value={form.args[name]?.required ? "yes" : "no"}
                  options={[
                    { id: "no", label: t("Optional") },
                    { id: "yes", label: t("Required") },
                  ]}
                  onChange={(value) => editArg(name, { required: value === "yes" })}
                />
                {problems[name] && (
                  <span className="ui-error" role="alert">
                    {t(problems[name])}
                  </span>
                )}
              </Panel>
            ))}
          </Field>
          <Field label={t("Script · read-only")} group hint={props.path}>
            <pre className="ui-code-block buff-wf-script" data-slot="buff-wf-script">
              {props.script}
            </pre>
          </Field>
          {problem && (
            <p className="ui-error" role="alert">
              {t(problem)}
            </p>
          )}
          {saved && <p className="ui-hint">{t("Saved.")}</p>}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" data-action="buff-wf-remove" onClick={leave(props.onRemove)}>
          {t("Delete")}
        </Button>
        <Button variant="ghost" data-action="buff-wf-fix-saved" onClick={leave(props.onFixInChat)}>
          {t("Fix in chat")}
        </Button>
        <Button data-action="buff-wf-detail-start" onClick={leave(props.onStart)}>
          {t("Run")}
        </Button>
        <Button variant="primary" data-action="buff-wf-save-meta" onClick={() => void save()}>
          {t("Save")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
