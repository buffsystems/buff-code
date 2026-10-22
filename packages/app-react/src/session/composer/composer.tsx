// The wired composer (#584), ported from the Solid composer model (composer/model.ts): one draft,
// one controller and one model pick, with the suggestion sources (slash commands, references,
// skills, agents, MCP resources, files), attachments, history, sending and the composer's
// commands. The session slot and the draft screen give it an adapter that says where sends go.

import { composerPlaceholder } from "@opencode/app/react-reuse/composer-placeholder"
import { setCursorPosition, getCursorPosition } from "@opencode/app/react-reuse/composer-dom"
import type { ComposerSuggestion } from "@opencode/app/react-reuse/composer-types"
import { Skill } from "@opencode/schema/skill"
import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { formatKeybindParts, formatKeybind } from "../../commands/keybind"
import { useCommandRegistration, useCommands } from "../../commands/provider"
import type { Server } from "../../core/servers"
import { locationKey } from "../../core/data/state"
import { useDialog } from "../../dialog/dialogs"
import { openManageModels } from "../../providers/models/manage"
import { useI18n } from "../../i18n/provider"
import { useCore, useServerData } from "../../react/core"
import { showToast } from "../../shell/notifications/toast"
import { createAttachments, type Attachments } from "./attachments/attachments"
import { uploadFile } from "./attachments/uploads"
import type { ComposerDraft } from "./draft/draft"
import { createComposerController, type ComposerController, type ComposerQueue } from "./editor/controller"
import { dropState } from "./drop"
import { promptHistory } from "./history/history"
import { historyComments } from "./prompt-context"
import type { ContextItem } from "@opencode/app/react-reuse/composer-schema"
import type { PromptHistoryComment } from "@opencode/app/react-reuse/composer-history-entry"
import { ModelControl, ModelDialog } from "./models/model-picker"
import type { ModelSelectionHandle } from "./models/use-selection"
import { createComposerSubmit, type ComposerAdapter } from "./submit/submit"
import { ComposerView } from "./view/composer"

export type ComposerProps = {
  server: Server
  directory: string
  draft: ComposerDraft
  selection: ModelSelectionHandle
  adapter: ComposerAdapter
  working: boolean
  queue?: ComposerQueue
  /** Paths of the session's open file tabs, the active first: the @ list offers them first. */
  recentFiles?(): string[]
  /** The side panes' side of context chips and comments (sessions only). */
  context?: { remove(item: ContextItem): void; clear(items: ContextItem[]): void; open(item: ContextItem): void }
  /** Buff's permission mode, shown before the model. */
  beforeModel?: ReactNode
  borderUnderlay?: boolean
  onEditor?(editor: HTMLElement | undefined): void
}

export function Composer(props: ComposerProps) {
  const i18n = useI18n()
  const core = useCore()
  const dialog = useDialog()
  const manage = () => openManageModels(dialog, { server: props.server, directory: props.directory })
  const commands = useCommands()
  const host = useMemo(
    () => ({ storage: core.platform.storage, draftStore: core.platform.draftStore }),
    [core.platform],
  )
  const history = promptHistory(host)
  const ref = useMemo(() => ({ directory: props.directory }), [props.directory])
  const location = useServerData(props.server, (state) => state.location[locationKey({ directory: props.directory })])
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const data = props.server.data
    const quiet = () => undefined
    void data.location.command.sync(ref).catch(quiet)
    void data.location.reference.sync(ref).catch(quiet)
    void data.location.skill.sync(ref).catch(quiet)
    void data.location.mcpResource.sync(ref).catch(quiet)
  }, [props.server, ref])

  // The comments a send took, cleared from the side panes once it went out.
  const sent = useRef<(ContextItem & { key: string })[]>([])
  const sources = useRef({ location, commands })
  sources.current = { location, commands }

  const controller: ComposerController = useMemo(() => {
    const keys = (id: string) => {
      const keybind = commands.keybind(id)
      return keybind ? formatKeybindParts(keybind, i18n.t) : undefined
    }
    return createComposerController(props.draft, () => ({
      history: {
        entries: (mode) => history.entries(mode).map((entry) => ({ prompt: entry.prompt, metadata: entry.comments })),
        add: (prompt, mode) => history.add(prompt, mode, mode === "shell" ? [] : historyComments(props.draft.contextItems())),
        capture: () => historyComments(props.draft.contextItems()),
        restore: (metadata) => restoreComments(props.draft, metadata as PromptHistoryComment[] | undefined),
      },
      commands: () => slashCommands(sources.current, keys),
      context: () => [
        ...contextSuggestions(sources.current.location, latest.current.selection),
        ...(latest.current.recentFiles?.() ?? []).map(
          (path): ComposerSuggestion => ({
            id: `file:${path}`,
            kind: "file",
            label: path,
            path,
            recent: true,
            mention: { type: "file", path, content: `@${path}`, start: 0, end: 0 },
          }),
        ),
      ],
      searchContextFiles: (query) =>
        latest.current.server
          .api()
          .file.find({ location: { directory: latest.current.directory }, query })
          .then(
            (result) =>
              result.data.map((entry): ComposerSuggestion => ({
                id: `file:${entry.path}`,
                kind: "file",
                label: entry.path,
                path: entry.path,
                mention: { type: "file", path: entry.path, content: `@${entry.path}`, start: 0, end: 0 },
              })),
            () => [],
          ),
      onSuggestionSelect: (item) => {
        if (item.kind !== "command" || item.id.startsWith("custom.")) return
        return () => commands.trigger(item.id, "slash")
      },
      attach: () => attachments.pick(() => fileInput(controller.editor())?.click()),
      pasteFiles: (event): boolean => attachments.paste(event),
      submit: {
        available: () => submitAvailable(),
        working: () => latest.current.working,
        queue: latest.current.queue,
        onSubmit: (options) => {
          if (!submitAvailable()) return
          const queue = latest.current.queue
          // Confirming an edit re-admits the queued prompt instead of sending a new one.
          if (queue?.editing()) return queue.confirmEdit(options?.alternate ? "steer" : "queue")
          void submit.submit(options)
        },
        onStop: () => void submit.stop(),
      },
    }))
    // One controller per draft: the rest is read fresh through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.draft])
  useEffect(() => controller.connect(), [controller])
  // The screen's dropzone follows this composer's drag state.
  useEffect(() => {
    const sync = () =>
      dropState.set(() => ({
        active: controller.interaction.get().drag === "active",
        input: latest.current.selection.selection.model?.capabilities.input,
      }))
    const stop = controller.interaction.subscribe(sync)
    return () => {
      stop()
      dropState.set(() => ({ active: false }))
    }
  }, [controller])

  const submitAvailable = () => {
    const selection = latest.current.selection.selection
    return controller.interaction.get().mode === "shell" || selection.paid || selection.loading
  }

  const attachments: Attachments = useMemo(
    () =>
      createAttachments({
        draft: props.draft,
        directory: () => latest.current.directory,
        destination: () => {
          const server = latest.current.server
          const http = server.conn.type === "ssh" ? undefined : server.conn.http
          return {
            input: latest.current.selection.selection.model?.capabilities.input ?? { image: false, pdf: false },
            local: server.conn.type === "sidecar" || (!!http && isLocalHost(http.url)),
            upload: async (file, report, signal) => {
              if (!http) throw new Error("Upload failed")
              const info = await server.api().server.info({ signal })
              const url = new URL("/api/experimental/fs/write", http.url)
              url.searchParams.set("location[directory]", latest.current.directory)
              url.searchParams.set("path", `${info.paths.tmp}/uploads/${crypto.randomUUID()}/${file.name}`)
              return uploadFile({ url, file, password: http.password, report, signal })
            },
          }
        },
        picker: core.platform.openAttachmentPickerDialog,
        getPathForFile: core.platform.getPathForFile,
        readClipboardImage: core.platform.readClipboardImage,
        onDragCancel: core.platform.onDragCancel,
        store: core.platform.draftStore?.putBlob,
        isDialogActive: dialog.active,
        focusEditor: () => controller.editor()?.focus(),
        setDragging: (active) => controller.dispatch({ type: active ? "drag.enter" : "drag.leave" }),
        duplicate: () => showToast({ title: i18n.t("prompt.toast.attachmentDuplicate.title") }),
        onError: (error) =>
          showToast({
            variant: "error",
            title: i18n.t("common.requestFailed"),
            description: error instanceof Error ? error.message : String(error),
          }),
        onUploadError: (error) =>
          showToast({ variant: "error", title: i18n.t("prompt.toast.uploadFailed.title"), description: errorMessage(error, i18n.t("common.requestFailed")) }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.draft, controller],
  )

  const submit = useMemo(
    () =>
      createComposerSubmit({
        get adapter() {
          return latest.current.adapter
        },
        mode: () => controller.interaction.get().mode,
        commands: () => sources.current.location?.command,
        editor: controller.editor,
        addToHistory: (prompt, mode) => controller.addHistory(prompt, mode),
        removeFromHistory: (prompt, mode, comments) => history.remove(prompt, mode, comments),
        resetHistory: controller.resetHistory,
        setMode: (mode) => controller.dispatch({ type: mode === "shell" ? "mode.shell" : "mode.normal" }),
        closePopover: () => controller.dispatch({ type: "popover.close" }),
        delivery: (alternate) => {
          const queue = latest.current.queue
          if (!queue) return "steer"
          return (alternate ? queue.alternate() : queue.delivery()) ?? "steer"
        },
        notify: {
          missingSelection: () =>
            showToast({
              title: i18n.t("prompt.toast.modelAgentRequired.title"),
              description: i18n.t("prompt.toast.modelAgentRequired.description"),
            }),
          failed: (kind, error) =>
            showToast({
              title: i18n.t(
                kind === "shell"
                  ? "prompt.toast.shellSendFailed.title"
                  : kind === "command"
                    ? "prompt.toast.commandSendFailed.title"
                    : "prompt.toast.promptSendFailed.title",
              ),
              description: errorMessage(error, i18n.t("common.requestFailed")),
            }),
        },
        comments: {
          capture: () => {
            sent.current = props.draft.contextItems().filter((item) => !!item.comment?.trim())
            return historyComments(sent.current)
          },
          clear: () => latest.current.context?.clear(sent.current),
          restore: (comments) => restoreComments(props.draft, comments),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller],
  )

  useEffect(() => {
    props.onEditor?.(controller.editor())
    return () => props.onEditor?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller])

  const handle = props.selection
  const mode = () => controller.interaction.get().mode
  const restoreFocus = () => restoreComposerFocus()
  useCommandRegistration("composer", () => [
    {
      id: "model.choose",
      title: i18n.t("command.model.choose"),
      description: i18n.t("command.model.choose.description"),
      category: i18n.t("command.category.model"),
      keybind: "mod+'",
      slash: "model",
      onSelect: () => {
        const restore = captureComposerCursor()
        dialog.show((close) => (
          <ModelDialog
            handle={latest.current.selection}
            onManage={manage}
            onClose={() => {
              close()
              restore()
            }}
          />
        ))
      },
    },
    {
      id: "model.variant.cycle",
      title: i18n.t("command.model.variant.cycle"),
      description: i18n.t("command.model.variant.cycle.description"),
      category: i18n.t("command.category.model"),
      keybind: "shift+mod+d",
      onSelect: () => latest.current.selection.cycleVariant(),
    },
    {
      id: "agent.cycle",
      title: i18n.t("command.agent.cycle"),
      description: i18n.t("command.agent.cycle.description"),
      category: i18n.t("command.category.agent"),
      keybind: "mod+.",
      slash: "agent",
      disabled: !handle.selection.agentsVisible,
      onSelect: () => latest.current.selection.cycleAgent(1),
    },
    {
      id: "agent.cycle.reverse",
      title: i18n.t("command.agent.cycle.reverse"),
      description: i18n.t("command.agent.cycle.reverse.description"),
      category: i18n.t("command.category.agent"),
      keybind: "shift+mod+.",
      disabled: !handle.selection.agentsVisible,
      onSelect: () => latest.current.selection.cycleAgent(-1),
    },
    {
      id: "file.attach",
      title: i18n.t("prompt.action.attachFile"),
      category: i18n.t("command.category.file"),
      keybind: "mod+u",
      disabled: mode() !== "normal",
      onSelect: () => attachments.pick(() => fileInput(controller.editor())?.click()),
    },
    {
      id: "prompt.mode.shell",
      title: i18n.t("command.prompt.mode.shell"),
      category: i18n.t("command.category.session"),
      keybind: "mod+shift+x",
      disabled: mode() === "shell",
      onSelect: () => controller.dispatch({ type: "mode.shell" }),
    },
    {
      id: "prompt.mode.normal",
      title: i18n.t("command.prompt.mode.normal"),
      category: i18n.t("command.category.session"),
      keybind: "mod+shift+e",
      disabled: mode() === "normal",
      onSelect: () => controller.dispatch({ type: "mode.normal" }),
    },
  ])

  const parts = (id: string, fallback: string) => formatKeybindParts(commands.keybind(id) ?? fallback, i18n.t)
  const selection = handle.selection
  const followUp = props.working || (props.queue?.count() ?? 0) > 0
  const placeholder = composerPlaceholder(
    controller.interaction.get().mode,
    (key, params) => i18n.t(key as Parameters<typeof i18n.t>[0], params),
    followUp,
  )
  return (
    <ComposerView
      controller={controller}
      attachments={attachments}
      placeholder={placeholder}
      available={submitAvailable()}
      working={props.working}
      queue={props.queue}
      borderUnderlay={props.borderUnderlay}
      agent={
        selection.agentsVisible
          ? {
              options: selection.agents.map((agent) => ({ id: agent.name, label: agent.name })),
              current: selection.agent?.name ?? "",
              onSelect: handle.setAgent,
            }
          : undefined
      }
      variant={{
        options: ["default", ...selection.variants].map((value) => ({ id: value, label: value })),
        current: selection.variant ?? "default",
        onSelect: (value) => handle.setVariant(value === "default" ? undefined : value),
      }}
      modelControls={
        <>
          {props.beforeModel}
          <ModelControl
            handle={handle}
            title={i18n.t("command.model.choose")}
            keys={parts("model.choose", "mod+'")}
            onClose={restoreFocus}
            onUnpaid={() => commands.trigger("buff.signin")}
            onManage={manage}
          />
        </>
      }
      keys={{
        attach: parts("file.attach", "mod+u"),
        attachShortcut: formatKeybind(commands.keybind("file.attach") ?? "mod+u", i18n.t),
        agent: parts("agent.cycle", "mod+."),
        variant: parts("model.variant.cycle", "shift+mod+d"),
        alternate: [formatKeybind("mod", i18n.t), "↵"],
        exitShell: [formatKeybind("esc", i18n.t)],
      }}
      onContextRemove={(item) => props.context?.remove(item)}
      onContextOpen={(item) => props.context?.open(item)}
      onStop={() => void submit.stop()}
    />
  )
}

function restoreComments(draft: ComposerDraft, comments: PromptHistoryComment[] | undefined) {
  draft.context.replaceComments(
    (comments ?? []).map((comment) => ({
      type: "file",
      path: comment.path,
      selection: { startLine: comment.selection.start, endLine: comment.selection.end, startChar: 0, endChar: 0 },
      comment: comment.comment,
      commentID: comment.id,
      commentOrigin: comment.origin,
      preview: comment.preview,
    })),
  )
}

function slashCommands(
  sources: { location: { command?: { name: string; description?: string }[] } | undefined; commands: ReturnType<typeof useCommands> },
  keys: (id: string) => string[] | undefined,
): ComposerSuggestion[] {
  const custom = (sources.location?.command ?? []).map((item) => ({
    id: `custom.${item.name}`,
    kind: "command" as const,
    label: `/${item.name}`,
    trigger: item.name,
    title: item.name,
    description: item.description,
  }))
  const builtin = sources.commands
    .options()
    .filter((item) => !item.disabled && !item.id.startsWith("suggested.") && item.slash)
    .map((item) => ({
      id: item.id,
      kind: "command" as const,
      label: `/${item.slash}`,
      trigger: item.slash,
      title: item.title,
      description: item.description,
      keybind: keys(item.id),
    }))
  return [...custom, ...builtin]
}

function contextSuggestions(
  location:
    | {
        reference?: { name: string; path: string; hidden?: boolean; description?: string; source: { type: string; repository?: string; path?: string } }[]
        skill?: { id: string; name: string; description?: string }[]
        mcpResource?: { server: string; uri: string; name: string; description?: string; mimeType?: string }[]
      }
    | undefined,
  selection: ModelSelectionHandle,
): ComposerSuggestion[] {
  const references = (location?.reference ?? [])
    .filter((reference) => !reference.hidden)
    .map((reference) => ({
      id: `reference:${reference.name}`,
      kind: "reference" as const,
      label: `@${reference.name}`,
      path: reference.path,
      description: reference.description ?? (reference.source.type === "git" ? reference.source.repository : reference.source.path),
      mention: {
        type: "file" as const,
        path: reference.path,
        content: `@${reference.name}`,
        start: 0,
        end: 0,
        mime: "application/x-directory",
        filename: reference.name,
      },
    }))
  const skills = (location?.skill ?? []).map((skill) => ({
    id: `skill:${skill.id}`,
    kind: "skill" as const,
    label: `@${skill.id}`,
    description: skill.description,
    mention: {
      type: "skill" as const,
      id: Skill.ID.make(skill.id),
      name: Skill.Name.make(skill.name),
      content: `@${skill.id}`,
      start: 0,
      end: 0,
    },
  }))
  const agents = selection.selection.subagents.map((agent) => ({
    id: `agent:${agent.name}`,
    kind: "agent" as const,
    label: `@${agent.name}`,
    mention: { type: "agent" as const, name: agent.name, content: `@${agent.name}`, start: 0, end: 0 },
  }))
  const resources = (location?.mcpResource ?? []).map((resource) => ({
    id: `resource:${resource.server}:${resource.uri}`,
    kind: "resource" as const,
    label: `@${resource.name}`,
    path: resource.uri,
    description: resource.description,
    mention: {
      type: "file" as const,
      path: resource.uri,
      content: `@${resource.name}`,
      start: 0,
      end: 0,
      mime: resource.mimeType ?? "text/plain",
      filename: resource.name,
      url: resource.uri,
      source: {
        type: "resource" as const,
        text: { value: `@${resource.name}`, start: 0, end: resource.name.length + 1 },
        clientName: resource.server,
        uri: resource.uri,
      },
    },
  }))
  return [...references, ...skills, ...agents, ...resources]
}

function fileInput(editor: HTMLElement | undefined) {
  return editor?.closest(".relative")?.querySelector<HTMLInputElement>('[data-slot="composer-file-input"]')
}

/** Back to the composer after a menu or dialog closed, with the caret where it was. */
export function restoreComposerFocus(cursor?: number) {
  requestAnimationFrame(() => {
    const editor = document.querySelector<HTMLElement>('[data-component="composer-editor"]')
    if (!editor) return
    editor.focus()
    if (cursor !== undefined) setCursorPosition(editor, cursor)
  })
}

function captureComposerCursor() {
  const editor = document.querySelector<HTMLElement>('[data-component="composer-editor"]')
  const selection = window.getSelection()
  const cursor = editor && selection?.rangeCount && editor.contains(selection.anchorNode) ? getCursorPosition(editor) : undefined
  return () => restoreComposerFocus(cursor)
}

function isLocalHost(url: string) {
  const host = URL.canParse(url) ? new URL(url).hostname : ""
  return host === "localhost" || host === "[::1]" || host.startsWith("127.")
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  return fallback
}

