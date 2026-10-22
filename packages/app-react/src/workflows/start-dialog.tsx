// Starting a saved workflow (#448), ported from the Solid window's buff/workflows/start-dialog.tsx:
// a field per argument by its type — text, number, yes/no, JSON — with the default and the problem
// under it, and the project it runs in. The run goes into a new session of the project.

import { Button, Dialog, DialogBody, DialogFooter, Field, Input, Segmented, SelectMenu, Textarea } from "@buff/ui/react"
import type { BuffWorkflowFile } from "@opencode/schema/buff-workflow-file"
import { BuffWorkflowFlow } from "@opencode/schema/buff-workflow-flow"
import { useState } from "react"
import { useI18n } from "../i18n/provider"
import type { Started } from "./controller"

const UNSET = "unset"

export function StartDialog(props: {
  meta: BuffWorkflowFile.Meta
  directories: readonly string[]
  onClose: () => void
  onStart: (args: Record<string, unknown>, directory: string) => Promise<Started>
  onStarted: (run: string) => void
}) {
  const t = useI18n().buff.t
  const [texts, setTexts] = useState<Record<string, string>>(() => BuffWorkflowFlow.formTexts(props.meta.args))
  const [problems, setProblems] = useState<Readonly<Record<string, string>>>({})
  const [problem, setProblem] = useState<string>()
  const [directory, setDirectory] = useState(props.directories[0] ?? "")
  const [starting, setStarting] = useState(false)
  const setText = (name: string, value: string) => setTexts((current) => ({ ...current, [name]: value }))

  const start = async () => {
    setProblem(undefined)
    const checked = BuffWorkflowFlow.formValues(props.meta.args, texts)
    if ("problems" in checked) return setProblems(checked.problems)
    setProblems({})
    if (!directory) return setProblem(t("Choose a project."))
    setStarting(true)
    const started = await props.onStart({ ...checked.values }, directory)
    setStarting(false)
    if (started.problems) return setProblems(started.problems)
    if (!started.run) return setProblem(started.problem ?? t("The workflow did not start."))
    props.onClose()
    props.onStarted(started.run)
  }

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && props.onClose()}
      title={t("Run «{name}»", { name: props.meta.name })}
      description={props.meta.description}
      closeLabel={t("Close")}
    >
      <DialogBody>
        <div className="flex flex-col gap-4" data-component="buff-workflow-start">
          {!Object.keys(props.meta.args).length && (
            <span className="ui-hint">{t("The workflow has no arguments.")}</span>
          )}
          {Object.entries(props.meta.args).map(([name, decl]) => (
            <Field
              key={name}
              group={decl.type === "boolean"}
              label={`${name} · ${t(BuffWorkflowFlow.TYPE_LABEL[decl.type])}${decl.required ? ` · ${t("required")}` : ""}`}
              hint={decl.description}
              error={problems[name] && t(problems[name])}
            >
              {decl.type === "boolean" ? (
                <Segmented
                  size="sm"
                  value={texts[name] || UNSET}
                  options={[
                    { id: UNSET, label: t("Not set") },
                    { id: "true", label: t("Yes") },
                    { id: "false", label: t("No") },
                  ]}
                  onChange={(value) => setText(name, value === UNSET ? "" : value)}
                />
              ) : decl.type === "json" ? (
                <Textarea
                  rows={4}
                  data-arg={name}
                  placeholder={t('{"key": "value"}')}
                  value={texts[name] ?? ""}
                  onChange={(event) => setText(name, event.currentTarget.value)}
                />
              ) : (
                <Input
                  data-arg={name}
                  value={texts[name] ?? ""}
                  onChange={(event) => setText(name, event.currentTarget.value)}
                />
              )}
            </Field>
          ))}
          <Field
            label={t("Project")}
            group
            hint={t("The run goes into a new session of this project; subagents work in it with the usual tools.")}
          >
            <SelectMenu
              aria-label={t("Project")}
              value={directory || undefined}
              options={props.directories.map((item) => ({ value: item, label: item }))}
              onValueChange={setDirectory}
            />
          </Field>
          {problem && (
            <p className="ui-error" role="alert">
              {problem}
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={props.onClose}>{t("Cancel")}</Button>
        <Button variant="primary" loading={starting} data-action="buff-workflow-start" onClick={() => void start()}>
          {t("Run")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
