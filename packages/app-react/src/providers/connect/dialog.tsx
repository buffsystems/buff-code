// «Connect a provider» (#584), ported from the Solid window's connect/dialog.tsx: a searchable list
// of the providers one can connect, then the chosen one's connection — its methods, an API key,
// the method's form, OAuth by a code or by waiting. Buff (#457, #470): signing in to Buff opens
// straight on Buff, with the connector hint, «Later», the code's time left and a new code — and
// (#562) a way to the list for one's own provider instead.

import "../providers.css"
import { Badge, Button, CopyField, Dialog, DialogBody, Field, IconButton, Input, Spinner } from "@buff/ui/react"
import { BUFF_PROVIDER } from "@opencode/app/react-reuse/buff-providers"
import type { FormAnswer, FormStringField } from "@opencode/client/promise"
import { ArrowLeft, Ban, Search } from "lucide-react"
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { Server } from "../../core/servers"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"
import { useStore } from "../../react/use-store"
import { showToast } from "../../shell/notifications/toast"
import { BuffConnectorHint, BuffSignInCodeStatus } from "../../buff/sign-in/code-status"
import { writeClipboard } from "../../session/timeline/parts/text"
import { useIntegrations, useProviderCatalog } from "../catalog/use-catalog"
import { ProviderIcon } from "../provider-icon"
import { createProviderConnection, type ProviderConnection } from "./controller"
import { OwnProviderForm } from "../own/form"
import { ModelCheck } from "../own/model-check"
import { BuffProvider } from "@opencode/schema/buff-provider"

// Buff (#596): OpenCode Go / Zen are upstream clouds — listed, last, not promoted.
const FEATURED = [BUFF_PROVIDER, "anthropic", "openai", "google", "openrouter", "vercel", "opencode-go", "opencode"]
/** One's own server (#562): LiteLLM or any OpenAI-compatible one — a form, not a catalog provider. */
const OWN = "own:"
const ownPreset = (selected: string | undefined): BuffProvider.Preset | undefined =>
  selected === `${OWN}litellm` ? "litellm" : selected === `${OWN}custom` ? "custom" : undefined

export function DialogConnectProvider(props: {
  server: Server
  directory?: string
  /** Open on this provider (Buff's sign-in) instead of the list. */
  provider?: string
  onClose: () => void
}) {
  const i18n = useI18n()
  const [selected, setSelected] = useState(props.provider)
  const back = useRef<() => void>(() => setSelected(undefined))
  const title =
    selected === BUFF_PROVIDER
      ? i18n.t("provider.connect.title", { provider: "Buff" })
      : i18n.t("command.provider.connect")
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} title={title} closeLabel={i18n.t("common.close")}>
      <DialogBody>
        <div data-component="dialog-connect-provider" className="flex min-h-0 flex-col gap-3">
          {selected && (
            <div>
              <IconButton
                icon={ArrowLeft}
                size="xs"
                aria-label={i18n.t("common.goBack")}
                onClick={() => (props.provider === selected ? props.onClose() : back.current())}
              />
            </div>
          )}
          {ownPreset(selected) ? (
            <OwnProvider
              key={selected}
              server={props.server}
              directory={props.directory}
              preset={ownPreset(selected) ?? "custom"}
              onClose={props.onClose}
            />
          ) : selected ? (
            <Connection
              key={selected}
              server={props.server}
              directory={props.directory}
              provider={selected}
              onClose={props.onClose}
              onOther={() => setSelected(undefined)}
              setBack={(handler) => (back.current = handler ?? (() => setSelected(undefined)))}
            />
          ) : (
            <Picker server={props.server} directory={props.directory} onSelect={setSelected} />
          )}
        </div>
      </DialogBody>
    </Dialog>
  )
}

function Picker(props: { server: Server; directory?: string; onSelect: (provider: string) => void }) {
  const i18n = useI18n()
  const integrations = useIntegrations(props.server, props.directory)
  const [filter, setFilter] = useState("")
  const [active, setActive] = useState<string>()
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => list.current?.querySelector("input")?.focus({ preventScroll: true }), [])
  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const all = integrations.filter((item) => !query || `${item.id} ${item.name}`.toLowerCase().includes(query))
    return [
      {
        title: i18n.t("dialog.provider.group.popular"),
        items: all
          .filter((item) => FEATURED.includes(item.id))
          .toSorted((a, b) => FEATURED.indexOf(a.id) - FEATURED.indexOf(b.id)),
      },
      {
        title: i18n.t("dialog.provider.group.other"),
        items: all.filter((item) => !FEATURED.includes(item.id)).toSorted((a, b) => a.name.localeCompare(b.name)),
      },
    ]
  }, [integrations, filter, i18n])
  const rows = groups.flatMap((group) => group.items)
  // #562: one's own server — right after the popular providers, found by the search like the rest.
  const query = filter.trim().toLowerCase()
  const own = (
    [
      ["litellm", "LiteLLM", i18n.buff.t("A LiteLLM proxy: its address and key")],
      ["custom", i18n.buff.t("Another OpenAI-compatible server"), i18n.buff.t("vLLM, Ollama, LM Studio, a gateway")],
    ] as const
  ).filter(
    ([preset, title, note]) =>
      !query || `${preset} openai ${title} ${note} ${i18n.buff.t("Your own server")}`.toLowerCase().includes(query),
  )

  const move = (direction: number) => {
    if (!rows.length) return
    const index = rows.findIndex((item) => item.id === active)
    const next = index < 0 ? (direction > 0 ? 0 : rows.length - 1) : (index + direction + rows.length) % rows.length
    const id = rows[next]?.id
    setActive(id)
    if (id)
      list.current?.querySelector<HTMLElement>(`[data-provider-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      return move(event.key === "ArrowDown" ? 1 : -1)
    }
    if (event.key !== "Enter" || !active) return
    event.preventDefault()
    props.onSelect(active)
  }

  const ownSection = (
    <section className="flex flex-col" data-component="own-providers">
      <div className="ui-hint px-3 pb-2">{i18n.buff.t("Your own server")}</div>
      {own.map(([preset, title, note]) => (
        <button
          key={preset}
          type="button"
          className="provider-list-row"
          data-provider-id={`${OWN}${preset}`}
          onClick={() => props.onSelect(`${OWN}${preset}`)}
        >
          <ProviderIcon id={preset === "litellm" ? "litellm" : "synthetic"} />
          <span className="provider-list-name">{title}</span>
          <span className="provider-list-note">{note}</span>
        </button>
      ))}
    </section>
  )

  return (
    <div ref={list} className="flex min-h-0 flex-col gap-4" onKeyDown={onKeyDown}>
      <Input
        type="search"
        leadingIcon={Search}
        value={filter}
        placeholder={i18n.t("dialog.provider.search.placeholder")}
        aria-label={i18n.t("dialog.provider.search.placeholder")}
        onChange={(event) => {
          setFilter(event.currentTarget.value)
          setActive(undefined)
        }}
      />
      <div className="flex max-h-[min(60vh,420px)] min-h-0 flex-col gap-4 overflow-y-auto">
        {groups.map((group, index) => (
          <Fragment key={group.title}>
            {index === 1 && own.length > 0 && ownSection}
            {group.items.length > 0 && (
              <section className="flex flex-col">
                <div className="ui-hint px-3 pb-2">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="provider-list-row"
                    data-provider-id={item.id}
                    data-active={active === item.id}
                    onMouseEnter={() => setActive(item.id)}
                    onClick={() => props.onSelect(item.id)}
                  >
                    <ProviderIcon id={item.id} />
                    <span className="provider-list-name">{item.name}</span>
                    {item.id === BUFF_PROVIDER && (
                      <>
                        <span className="provider-list-note">{i18n.buff.t("Your organization's models")}</span>
                        <Badge>{i18n.t("dialog.provider.tag.recommended")}</Badge>
                      </>
                    )}
                  </button>
                ))}
              </section>
            )}
          </Fragment>
        ))}
        {rows.length === 0 && own.length === 0 && <div className="ui-note py-8 text-center">{i18n.t("dialog.provider.empty")}</div>}
      </div>
    </div>
  )
}

function Connection(props: {
  server: Server
  directory?: string
  provider: string
  onClose: () => void
  /** To the list: Buff's sign-in offers one's own provider instead (#562). */
  onOther: () => void
  setBack: (handler: (() => void) | undefined) => void
}) {
  const i18n = useI18n()
  const platform = usePlatform()
  const catalog = useProviderCatalog(props.server, props.directory)
  const [connection] = useState(() =>
    createProviderConnection({
      api: props.server.api,
      data: props.server.data,
      provider: props.provider,
      directory: props.directory,
      keyLabel: i18n.t("provider.connect.method.apiKey"),
      desktop: platform.platform === "desktop",
      t: i18n.buff.t,
      invalidCode: i18n.t("provider.connect.oauth.code.invalid"),
      onComplete: () => {
        // #562: one's own provider is checked right away — the check, not a toast, says whether the
        // key works. Buff's sign-in closes as before. (This runs from the first render's closure:
        // the name comes from the connection's store, not the catalog read then.)
        if (props.provider !== BUFF_PROVIDER) return setConnected(true)
        props.onClose()
        const provider = connection.store.get().integration?.name ?? props.provider
        showToast({
          variant: "success",
          title: i18n.t("provider.connect.toast.connected.title", { provider }),
          description: i18n.t("provider.connect.toast.connected.description", { provider }),
        })
      },
    }),
  )
  const [connected, setConnected] = useState(false)
  const state = useStore(connection.store, (value) => value)
  const name = () => catalog.catalog.all.get(props.provider)?.name ?? state.integration?.name ?? props.provider
  const buff = props.provider === BUFF_PROVIDER

  useEffect(() => {
    void connection.load()
    return () => connection.dispose()
  }, [connection])
  // «Back» steps from a chosen method to the methods when there are several.
  useEffect(() => {
    props.setBack(
      connection.methods().length > 1 && state.methodIndex !== undefined ? () => connection.reset() : undefined,
    )
  }, [state.methodIndex, state.integration])

  const method = connection.current()
  const body = () => {
    if (connected)
      return (
        <Connected
          server={props.server}
          directory={props.directory}
          providerID={props.provider}
          onReplaceKey={() => {
            setConnected(false)
            connection.retry()
          }}
          onClose={props.onClose}
        />
      )
    if (state.loading || state.state === "pending") return <Pending />
    if (state.methodIndex === undefined) return <Methods connection={connection} name={name()} />
    if (state.state === "form") return <AuthForm connection={connection} buff={buff} onLater={props.onClose} onOther={props.onOther} />
    if (state.state === "error") return <Failure connection={connection} buff={buff} name={name()} />
    if (method?.type === "key") return <ApiKey connection={connection} name={name()} provider={props.provider} />
    if (state.authorization?.mode === "code") return <OAuthCode connection={connection} name={name()} />
    if (state.authorization?.mode === "auto")
      return <OAuthAuto connection={connection} name={name()} buff={buff} onClose={props.onClose} />
    return null
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {!buff && (
        <div className="flex items-center gap-2">
          <ProviderIcon id={props.provider} />
          <span className="ui-title">
            {props.provider === "anthropic" && method?.label?.toLowerCase().includes("max")
              ? i18n.t("provider.connect.title.anthropicProMax")
              : i18n.t("provider.connect.title", { provider: name() })}
          </span>
        </div>
      )}
      {body()}
    </div>
  )
}

/** Connected (#562): check a model now, or close. */
function Connected(props: {
  server: Server
  directory?: string
  providerID: string
  models?: readonly BuffProvider.Model[]
  onReplaceKey: () => void
  onClose: () => void
}) {
  const i18n = useI18n()
  return (
    <div className="flex flex-col gap-3" data-component="provider-connected">
      {/* The key is only known to work once a model answers: the check runs at once. */}
      <ModelCheck
        server={props.server}
        directory={props.directory}
        providerID={props.providerID}
        models={props.models}
        auto
        onReplaceKey={props.onReplaceKey}
      />
      <div className="flex justify-end">
        <Button onClick={props.onClose}>{i18n.buff.t("Done")}</Button>
      </div>
    </div>
  )
}

/** One's own server (#562): the form, then the check of a model. */
function OwnProvider(props: { server: Server; directory?: string; preset: BuffProvider.Preset; onClose: () => void }) {
  const i18n = useI18n()
  const [saved, setSaved] = useState<BuffProvider.Entry>()
  // A refused key goes back to the form, filled in, for another key.
  const [editing, setEditing] = useState<BuffProvider.Entry>()
  const finish = async (value: NonNullable<typeof saved>) => {
    const location = props.directory ? { directory: props.directory } : undefined
    const reads = props.server.data.location
    reads.integration.invalidate(location)
    reads.provider.invalidate(location)
    reads.model.invalidate(location)
    await Promise.all([reads.integration.sync(location), reads.provider.sync(location), reads.model.sync(location)]).catch(
      () => undefined,
    )
    setSaved(value)
  }
  const title = props.preset === "litellm" ? "LiteLLM" : i18n.buff.t("Another OpenAI-compatible server")
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2">
        <ProviderIcon id={props.preset === "litellm" ? "litellm" : "synthetic"} />
        <span className="ui-title">{i18n.t("provider.connect.title", { provider: saved?.name ?? title })}</span>
      </div>
      {saved ? (
        <Connected
          server={props.server}
          directory={props.directory}
          providerID={saved.id}
          models={saved.models}
          onReplaceKey={() => {
            setEditing(saved)
            setSaved(undefined)
          }}
          onClose={props.onClose}
        />
      ) : (
        <OwnProviderForm
          key={editing?.id ?? "new"}
          server={props.server}
          directory={props.directory}
          preset={props.preset}
          entry={editing}
          onSaved={(value) => void finish({ ...value, hasKey: true })}
        />
      )}
    </div>
  )
}

function Pending() {
  const i18n = useI18n()
  return (
    <div className="flex items-center gap-2 text-sm">
      <Spinner />
      <span>{i18n.t("provider.connect.status.inProgress")}</span>
    </div>
  )
}

function Methods(props: { connection: ProviderConnection; name: string }) {
  const i18n = useI18n()
  const details = (method: { type?: string; label?: string }) => {
    const label = method.type === "key" ? i18n.t("provider.connect.method.apiKey") : (method.label ?? "")
    const suffix = method.label?.match(/\s+\((browser|headless)\)$/i)
    const hint = suffix?.[1]?.toLowerCase()
    return {
      label: suffix ? label.slice(0, -suffix[0].length) : label,
      hint:
        hint === "headless"
          ? i18n.t("provider.connect.method.headless")
          : hint === "browser" || (!hint && method.type === "key")
            ? i18n.t("provider.connect.method.browser")
            : undefined,
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="ui-note px-3">{i18n.t("provider.connect.selectMethod", { provider: props.name })}</div>
      <div className="flex flex-col">
        {props.connection.methods().map((method, index) => {
          const item = details(method)
          return (
            <button
              key={index}
              type="button"
              className="provider-list-row"
              onClick={() => void props.connection.select(index)}
            >
              <span className="provider-list-name">{item.label}</span>
              {item.hint && <span className="provider-list-note">{item.hint}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const matches = (field: FormStringField, value: Record<string, string>) =>
  (field.when ?? []).every((condition) => {
    const actual = value[condition.key]
    if (actual === undefined) return false
    return condition.op === "eq" ? actual === condition.value : actual !== condition.value
  })

function AuthForm(props: { connection: ProviderConnection; buff: boolean; onLater: () => void; onOther: () => void }) {
  const i18n = useI18n()
  const state = useStore(props.connection.store, (value) => value)
  const fields = (props.connection.current()?.form ?? []).flatMap((field) => (field.type === "string" ? [field] : []))
  // Buff (#470, #458): the form's defaults (the last connector address), then the answer refused.
  const [value, setValue] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(
      fields.flatMap((field) => (typeof field.default === "string" ? [[field.key, field.default]] : [])),
    ),
    ...stringAnswer(state.answer),
  }))
  const [index, setIndex] = useState(0)
  const position = fields.findIndex((field, at) => at >= index && matches(field, value))
  const field = fields[position]
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => form.current?.querySelector("input")?.focus(), [position])
  const valid = !!field && !field.options && (!field.required || (value[field.key] ?? "").trim().length > 0)

  const next = async (at: number, answer: Record<string, string>) => {
    const method = state.methodIndex
    if (method === undefined) return
    const following = fields.findIndex((item, i) => i > at && matches(item, answer))
    if (following !== -1) return setIndex(following)
    await props.connection.select(method, answer)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!field || !valid) return
    void next(position, value)
  }

  return (
    <form ref={form} className="flex flex-col items-start gap-4" onSubmit={submit}>
      {state.error && <FailureLine text={state.error} />}
      {field && !field.options && (
        <>
          <Field label={field.title ?? ""} className="w-full">
            <Input
              type="text"
              value={value[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) => {
                const text = event.currentTarget.value
                setValue((current) => ({ ...current, [field.key]: text }))
              }}
            />
          </Field>
          {props.buff && <BuffConnectorHint />}
          {/* #562: three buttons do not fit a narrow dialog — they wrap instead of scrolling it. */}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={!valid}>
              {i18n.t("common.continue")}
            </Button>
            {props.buff && (
              <>
                <Button type="button" variant="ghost" data-action="buff-sign-in-later" onClick={props.onLater}>
                  {i18n.buff.t("Later")}
                </Button>
                <Button type="button" variant="ghost" data-action="buff-sign-in-other" onClick={props.onOther}>
                  {i18n.buff.t("Connect another provider")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {field?.options && (
        <div className="flex w-full flex-col gap-1.5" role="radiogroup" aria-label={field.title}>
          <div className="text-sm">{field.title}</div>
          {field.options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={value[field.key] === option.value}
              className="provider-list-row"
              onClick={() => {
                const answer = { ...value, [field.key]: String(option.value) }
                setValue(answer)
                void next(position, answer)
              }}
            >
              <span className="provider-list-name">{option.label}</span>
              {option.description && <span className="provider-list-note">{option.description}</span>}
            </button>
          ))}
        </div>
      )}
    </form>
  )
}

function stringAnswer(answer: FormAnswer | undefined): Record<string, string> {
  if (!answer) return {}
  return Object.fromEntries(
    Object.entries(answer).flatMap(([key, item]) => (typeof item === "string" ? [[key, item]] : [])),
  )
}

function FailureLine(props: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm" data-component="sign-in-failure" role="alert">
      <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>{props.text}</span>
    </div>
  )
}

function Failure(props: { connection: ProviderConnection; buff: boolean; name: string }) {
  const i18n = useI18n()
  const error = useStore(props.connection.store, (state) => state.error ?? "")
  return (
    <div className="flex flex-col items-start gap-4">
      <FailureLine text={props.buff ? error : i18n.t("provider.connect.status.failed", { error })} />
      <Button variant="primary" onClick={() => props.connection.retry()}>
        {i18n.buff.t("Retry")}
      </Button>
    </div>
  )
}

function ApiKey(props: { connection: ProviderConnection; name: string; provider: string }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const [key, setKey] = useState("")
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!key.trim()) return setError(i18n.t("provider.connect.apiKey.required"))
    setError(undefined)
    await props.connection
      .connectKey(key)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
  }
  return (
    <div className="ui-note flex flex-col gap-5">
      {props.provider === "opencode" ? (
        <div className="flex flex-col gap-5">
          <div>{i18n.t("provider.connect.opencodeZen.line1")}</div>
          <div>{i18n.t("provider.connect.opencodeZen.line2")}</div>
          <div>
            {i18n.t("provider.connect.opencodeZen.visit.prefix")}
            <a
              href="https://opencode.ai/zen"
              className="ui-link"
              onClick={(event) => {
                event.preventDefault()
                platform.openExternal("https://opencode.ai/zen")
              }}
            >
              {i18n.t("provider.connect.opencodeZen.visit.link")}
            </a>
            {i18n.t("provider.connect.opencodeZen.visit.suffix")}
          </div>
        </div>
      ) : (
        <div>{i18n.t("provider.connect.apiKey.description", { provider: props.name })}</div>
      )}
      <form className="flex flex-col items-start gap-5 self-stretch" onSubmit={(event) => void submit(event)}>
        <Field
          className="w-full"
          label={i18n.t("provider.connect.apiKey.label", { provider: props.name })}
          error={error}
        >
          <Input
            name="apiKey"
            data-input="provider-api-key"
            autoFocus
            value={key}
            placeholder={i18n.t("provider.connect.apiKey.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKey(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" variant="primary" data-action="provider-connect-submit">
          {i18n.t("common.continue")}
        </Button>
      </form>
    </div>
  )
}

function OAuthCode(props: { connection: ProviderConnection; name: string }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const state = useStore(props.connection.store, (value) => value)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const url = state.authorization?.url ?? ""
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return setError(i18n.t("provider.connect.oauth.code.required"))
    setError(undefined)
    setError(await props.connection.completeCode(code))
  }
  return (
    <div className="ui-note flex flex-col gap-5">
      <div>
        {i18n.t("provider.connect.oauth.code.visit.prefix")}
        <a
          href={url}
          className="ui-link"
          onClick={(event) => {
            event.preventDefault()
            platform.openExternal(url)
          }}
        >
          {i18n.t("provider.connect.oauth.code.visit.link")}
        </a>
        {i18n.t("provider.connect.oauth.code.visit.suffix", { provider: props.name })}
      </div>
      <form className="flex flex-col items-start gap-5 self-stretch" onSubmit={(event) => void submit(event)}>
        <Field
          className="w-full"
          label={i18n.t("provider.connect.oauth.code.label", { method: props.connection.current()?.label ?? "" })}
          error={error}
        >
          <Input
            name="code"
            autoFocus
            value={code}
            placeholder={i18n.t("provider.connect.oauth.code.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setCode(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" variant="primary">
          {i18n.t("common.continue")}
        </Button>
      </form>
    </div>
  )
}

function OAuthAuto(props: { connection: ProviderConnection; name: string; buff: boolean; onClose: () => void }) {
  const i18n = useI18n()
  const platform = usePlatform()
  const authorization = useStore(props.connection.store, (state) => state.authorization)
  if (!authorization) return null
  const instructions = authorization.instructions
  const code = instructions.includes(":") ? instructions.split(":").pop()?.trim() : instructions
  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm">
        {i18n.t("provider.connect.oauth.auto.visit.prefix")}
        <a
          href={authorization.url}
          className="ui-link"
          onClick={(event) => {
            event.preventDefault()
            platform.openExternal(authorization.url)
          }}
        >
          {i18n.t("provider.connect.oauth.auto.visit.link")}
        </a>
        {i18n.t("provider.connect.oauth.auto.visit.suffix", { provider: props.name })}
      </div>
      <Field label={i18n.t("provider.connect.oauth.auto.confirmationCode")}>
        <CopyField
          value={code ?? ""}
          mono
          copy={writeClipboard}
          copyLabel={i18n.t("ui.textField.copyToClipboard")}
          copiedLabel={i18n.t("ui.textField.copied")}
        />
      </Field>
      {props.buff ? (
        <BuffSignInCodeStatus
          url={authorization.url}
          expires={authorization.time.expires}
          onCancel={() => {
            props.connection.cancel()
            props.onClose()
          }}
          onRenew={() => props.connection.retry()}
        />
      ) : (
        <div className="flex items-center gap-4 text-sm">
          <Spinner />
          <span>{i18n.t("provider.connect.status.waiting")}</span>
        </div>
      )}
    </div>
  )
}
