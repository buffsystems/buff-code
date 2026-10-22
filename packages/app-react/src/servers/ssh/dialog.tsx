// Adding or connecting to an SSH host (#584), ported from the Solid window's ssh/dialog.tsx: the
// host (or a whole ssh command) and a name, then the host's own prompts — a password, a host key to
// trust — until it is ready; an outdated remote server offers «Update and reconnect».

import { Button, Dialog, DialogBody, DialogFooter, Field, Input } from "@buff/ui/react"
import { isSshConnecting, sshName, type SshConfig, type SshItem } from "@opencode/app/ssh"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { useI18n } from "../../i18n/provider"
import { useSshState } from "./context"

export function SshDialog(props: {
  config?: SshConfig
  connect?: boolean
  promptOnly?: boolean
  onConnected?: () => void
  onClose: () => void
}) {
  const i18n = useI18n()
  const { ssh, items } = useSshState()
  const [id] = useState(() => props.config?.id ?? crypto.randomUUID())
  const [target, setTarget] = useState(props.config?.target ?? "")
  const [name, setName] = useState(props.config?.name ?? "")
  const [started, setStarted] = useState(!!props.promptOnly)
  const [prompted, setPrompted] = useState(!!props.promptOnly)
  const [response, setResponse] = useState("")
  const complete = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const item = items.find((entry) => entry.config.id === id)
  const failed = ssh.error(id)
  const error = failed ? i18n.t("common.requestFailed") : item?.error ? i18n.t(`ssh.error.${item.error}`) : undefined
  const busy = ssh.submitting(id) || (started && !failed && isSshConnecting(item?.stage ?? "connecting"))
  // While busy the last prompt stays on screen, so the form does not flash between challenges.
  const last = useRef<SshItem["prompt"]>(undefined)
  const prompt = item?.prompt ?? (busy ? last.current : undefined)
  last.current = prompt
  const waiting = busy || ssh.answered(id)
  const incompatible = item?.stage === "incompatible"

  const start = (replace = false) => {
    if (busy || !target.trim()) return
    setStarted(true)
    setPrompted(!!prompt)
    ssh.connect({ id, target, name }, { dialog: true, replace })
  }
  const respond = () => {
    const current = item?.prompt
    if (!current || waiting || (!current.confirm && !response)) return
    ssh.respond(id, current.id, current.confirm ? "yes" : response)
  }

  useEffect(() => {
    setResponse("")
    if (!prompt) return
    setPrompted(true)
    // A focused Continue must never become Trust between two challenges.
    if (prompt.confirm) queueMicrotask(() => cancel.current?.focus())
  }, [prompt?.id])
  useEffect(() => {
    if (!started || item?.stage !== "ready" || ssh.submitting(id) || complete.current) return
    complete.current = true
    props.onClose()
    if (props.onConnected) queueMicrotask(props.onConnected)
  })
  useEffect(() => {
    if (props.connect) start()
  }, [])
  const startedRef = useRef(started)
  startedRef.current = started
  useEffect(
    () => () => {
      if (startedRef.current && !complete.current) ssh.cancel(id)
    },
    [],
  )

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (prompt) return
    start(incompatible)
  }
  const showForm = !props.promptOnly && !incompatible && (!prompted || (!!error && !prompt))
  const title =
    prompted || props.config ? i18n.t("ssh.connectTo", { host: sshName({ name, target }) }) : i18n.t("ssh.add")
  const action = busy
    ? i18n.t("ssh.stage.connecting")
    : incompatible
      ? i18n.t("ssh.update")
      : props.config
        ? i18n.t("ssh.connect")
        : i18n.t("dialog.server.add.button")

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} title={title} size="sm" hideClose>
      <DialogBody>
        <div className="flex flex-col gap-5">
          {showForm && (
            <>
              <Field label={i18n.t("ssh.target")}>
                <Input
                  type="text"
                  dir="ltr"
                  autoFocus
                  value={target}
                  placeholder={i18n.t("ssh.placeholder")}
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy || !!prompt}
                  aria-invalid={!!error || undefined}
                  onChange={(event) => setTarget(event.currentTarget.value)}
                  onKeyDown={onKeyDown}
                />
              </Field>
              <Field label={i18n.t("dialog.server.add.name")}>
                <Input
                  type="text"
                  dir="auto"
                  value={name}
                  placeholder={i18n.t("dialog.server.add.namePlaceholder")}
                  disabled={busy || !!prompt}
                  onChange={(event) => setName(event.currentTarget.value)}
                  onKeyDown={onKeyDown}
                />
              </Field>
            </>
          )}
          {incompatible && (
            <div className="flex flex-col gap-2" role="status" aria-live="polite">
              <span className="ui-title ui-title--sm">{i18n.t("ssh.stage.incompatible")}</span>
              <span className="ui-note">{i18n.t("ssh.error.version")}</span>
            </div>
          )}
          {prompt && (
            <div key={prompt.id} className="flex flex-col gap-2">
              <pre id="ssh-prompt" className="ui-code-block" dir="auto">
                {prompt.text}
              </pre>
              {!prompt.confirm && (
                <Input
                  type="password"
                  aria-labelledby="ssh-prompt"
                  autoFocus
                  value={response}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={waiting}
                  onChange={(event) => setResponse(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    respond()
                  }}
                />
              )}
            </div>
          )}
          {!incompatible && error && (
            <span className="ui-error" role="alert">
              {error}
            </span>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button ref={cancel} onClick={props.onClose}>
          {i18n.t("common.cancel")}
        </Button>
        {prompt ? (
          <Button variant="primary" disabled={waiting || (!prompt.confirm && !response)} onClick={respond}>
            {waiting ? i18n.t("ssh.stage.connecting") : i18n.t(prompt.confirm ? "ssh.trust" : "ssh.continue")}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !target.trim()} onClick={() => start(incompatible)}>
            {action}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
