// The window's preferences (#584): the Solid window's settings.v3 — the same schema, migration and
// defaults (packages/app/src/settings/model.tsx, which is not Solid-free and cannot be imported) —
// as one persisted cell with plain setters. The settings screen writes it; the shell, the composer
// and the timeline read slices of it.

import { Persistence } from "@opencode/app/react-reuse/persistence-schema"
import { timelinePresets, type TimelineCategory, type TimelineDetail } from "@opencode/session-ui/timeline/detail"
import { Effect, Option, Schema, SchemaGetter } from "effect"
import { createPersisted } from "../core/persisted"
import { DEFAULT_STORAGE, type PlatformStorage } from "../platform/platform"

const placementSchema = Schema.Literals(["separate", "grouped", "hidden"])
const detailsSchema = Schema.Literals(["collapsed", "expanded"])
const activitySchema = Persistence.struct({ placement: placementSchema, details: detailsSchema })
const placementOnlySchema = Persistence.struct({ placement: placementSchema })

const settingsSchema = Persistence.struct({
  general: Persistence.struct({
    autoSave: Schema.Boolean,
    releaseNotes: Schema.Boolean,
    showFileTree: Schema.Boolean,
    showNavigation: Schema.Boolean,
    showSearch: Schema.Boolean,
    showProjectIcon: Schema.Boolean,
    showTerminal: Schema.Boolean,
    timelineDetail: Persistence.struct({
      shell: activitySchema,
      edit: activitySchema,
      thinking: activitySchema,
      subagents: placementOnlySchema,
      notices: placementOnlySchema,
      tools: placementOnlySchema,
    }),
    showCustomAgents: Schema.Boolean,
    mobileTitlebarPosition: Schema.Literals(["top", "bottom"]),
    mobileDiffWrap: Schema.Boolean,
    terminalPlacement: Schema.Literals(["side", "bottom"]),
    followUpBehavior: Schema.Literals(["queue", "steer"]),
    experimentalBrowser: Schema.Boolean,
  }),
  sessionSummary: Persistence.struct({ projectExpanded: Schema.Boolean, serverExpanded: Schema.Boolean }),
  appearance: Persistence.struct({
    fontSize: Schema.Number,
    mono: Schema.String,
    sans: Schema.String,
    terminal: Schema.String,
    tabLayout: Schema.Literals(["horizontal", "vertical"]),
    showProjectName: Schema.Boolean,
  }),
  keybinds: Persistence.record(Schema.String.pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))),
  permissions: Persistence.struct({ autoApprove: Schema.Boolean }),
  workspaces: Persistence.struct({
    defaultDestination: Schema.Literals(["last-used", "local", "new"]),
    lastUsed: Persistence.record(
      Schema.Literals(["local", "workspace"]).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none()))),
    ),
  }),
  notifications: Persistence.struct({ agent: Schema.Boolean, permissions: Schema.Boolean, errors: Schema.Boolean }),
  sounds: Persistence.struct({
    agentEnabled: Schema.Boolean,
    agent: Schema.String,
    permissionsEnabled: Schema.Boolean,
    permissions: Schema.String,
    errorsEnabled: Schema.Boolean,
    errors: Schema.String,
  }),
})

export type Settings = typeof settingsSchema.Type
export type WorkspaceDefaultDestination = Settings["workspaces"]["defaultDestination"]
export type TerminalPlacement = Settings["general"]["terminalPlacement"]
export type FollowUpBehavior = Settings["general"]["followUpBehavior"]
export type TabLayout = Settings["appearance"]["tabLayout"]

function storedTimelineCategory(category: TimelineCategory) {
  return Persistence.optional(
    Schema.Union([
      Schema.Struct({
        placement: Persistence.optional(placementSchema),
        details: Persistence.optional(detailsSchema),
      }),
      Schema.Literals(["expanded", "collapsed", "hidden", "visible"]),
    ]).pipe(
      Schema.decode({
        decode: SchemaGetter.transform((value) => {
          if (typeof value !== "string") return value
          return {
            placement: legacyPlacement(category, value),
            details: value === "expanded" ? "expanded" : "collapsed",
          }
        }),
        encode: SchemaGetter.passthrough(),
      }),
    ),
  )
}

function legacyPlacement(category: TimelineCategory, value: "expanded" | "collapsed" | "hidden" | "visible") {
  if (value === "hidden") return "hidden" as const
  if (category === "subagents") return "separate" as const
  if (category === "tools") return "grouped" as const
  if (value === "expanded") return "separate" as const
  if (value === "collapsed") return "grouped" as const
  return undefined
}

function legacyTimelineActivity(value: boolean | "hidden" | "compact" | "full" | null | undefined) {
  if (value === undefined || value === null) return
  const expanded = value === true || value === "full"
  return {
    placement: value === "hidden" ? "hidden" : expanded ? "separate" : "grouped",
    details: expanded ? "expanded" : "collapsed",
  } as const
}

const settingsPersistence = Persistence.migrate(
  settingsSchema,
  Schema.Struct({
    general: Persistence.optional(
      Schema.Struct({
        timelineDetail: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              shell: storedTimelineCategory("shell"),
              edit: storedTimelineCategory("edit"),
              thinking: storedTimelineCategory("thinking"),
              subagents: storedTimelineCategory("subagents"),
              notices: storedTimelineCategory("notices"),
              tools: storedTimelineCategory("tools"),
            }),
          ),
        ).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(null)))),
        reasoningMode: Schema.optional(Schema.NullOr(Schema.Literals(["hidden", "compact", "full"]))).pipe(
          Schema.catchDecoding(() => Effect.succeed(Option.some(null))),
        ),
        showReasoningSummaries: Persistence.optional(Schema.Boolean),
        shellToolPartsExpanded: Persistence.optional(Schema.Boolean),
        editToolPartsExpanded: Persistence.optional(Schema.Boolean),
      }),
    ),
  }).pipe(
    Schema.decode({
      decode: SchemaGetter.transform((value) => {
        const general = value.general
        if (!general || general.timelineDetail !== undefined) return value
        return {
          ...value,
          general: {
            ...general,
            timelineDetail: {
              shell: legacyTimelineActivity(general.shellToolPartsExpanded),
              edit: legacyTimelineActivity(general.editToolPartsExpanded),
              thinking: legacyTimelineActivity(
                general.reasoningMode === undefined ? general.showReasoningSummaries : general.reasoningMode,
              ),
            },
          },
        }
      }),
      encode: SchemaGetter.transform((value) => value),
    }),
  ),
)

export const DEFAULT_SETTINGS: Settings = {
  general: {
    autoSave: true,
    releaseNotes: true,
    showFileTree: false,
    showNavigation: false,
    showSearch: false,
    showProjectIcon: false,
    showTerminal: false,
    timelineDetail: structuredClone(timelinePresets[2].value),
    showCustomAgents: false,
    mobileTitlebarPosition: "top",
    mobileDiffWrap: true,
    terminalPlacement: "side",
    followUpBehavior: "steer",
    experimentalBrowser: false,
  },
  sessionSummary: { projectExpanded: true, serverExpanded: true },
  appearance: { fontSize: 14, mono: "", sans: "", terminal: "", tabLayout: "vertical", showProjectName: false },
  keybinds: {},
  permissions: { autoApprove: false },
  workspaces: { defaultDestination: "last-used", lastUsed: {} },
  notifications: { agent: true, permissions: true, errors: false },
  sounds: {
    agentEnabled: true,
    agent: "staplebops-01",
    permissionsEnabled: true,
    permissions: "staplebops-02",
    errorsEnabled: true,
    errors: "nope-03",
  },
}

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Persistence.withInitial(settingsPersistence, DEFAULT_SETTINGS)),
)

/** Stored settings over the defaults; a malformed field keeps its default, the rest survive. */
export function readSettings(raw: string): Settings {
  return Option.getOrElse(decode(raw), () => DEFAULT_SETTINGS)
}

export function createSettings(storage: (name: string) => PlatformStorage) {
  const cell = createPersisted({
    storage: storage(DEFAULT_STORAGE),
    key: "settings.v3",
    decode: readSettings,
    initial: DEFAULT_SETTINGS,
  })
  const section =
    <Key extends keyof Settings>(key: Key) =>
    (patch: Partial<Settings[Key]>) =>
      cell.set((settings) => ({ ...settings, [key]: { ...settings[key], ...patch } }))
  return {
    store: cell.store,
    ready: cell.ready,
    general: section("general"),
    sessionSummary: section("sessionSummary"),
    appearance: section("appearance"),
    permissions: section("permissions"),
    workspaces: section("workspaces"),
    notifications: section("notifications"),
    sounds: section("sounds"),
    setTimelineDetail: (value: TimelineDetail) => section("general")({ timelineDetail: structuredClone(value) }),
    /** A font field: blank text clears it back to the default face. */
    setFont: (field: "mono" | "sans" | "terminal", value: string) =>
      section("appearance")({ [field]: value.trim() ? value : "" }),
    keybinds: {
      set: (action: string, keybind: string) =>
        cell.set((settings) => ({ ...settings, keybinds: { ...settings.keybinds, [action]: keybind } })),
      reset: (action: string) =>
        cell.set((settings) => {
          if (!Object.hasOwn(settings.keybinds, action)) return settings
          const keybinds = { ...settings.keybinds }
          delete keybinds[action]
          return { ...settings, keybinds }
        }),
      resetAll: () => cell.set((settings) => ({ ...settings, keybinds: {} })),
    },
  }
}

export type SettingsModel = ReturnType<typeof createSettings>

const perWindow = new WeakMap<(name: string) => PlatformStorage, SettingsModel>()

/**
 * The window's one settings model over its storage: the settings screen writes it and every
 * reader — the shell, the timeline, the terminal, the browser pane, the core's first page — reads
 * the same store, so a change applies at once, without a reload.
 */
export function windowSettings(storage: (name: string) => PlatformStorage) {
  const existing = perWindow.get(storage)
  if (existing) return existing
  const created = createSettings(storage)
  perWindow.set(storage, created)
  return created
}

// The Buff faces first, the earlier ones after them (#471); a custom face goes in front.
export const fontDefaults = { sans: "Geist", mono: "Geist Mono", terminal: "JetBrainsMono Nerd Font Mono" } as const
const fontBases = {
  sans: '"Geist", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"Geist Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  terminal:
    '"JetBrainsMono Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as const

/** The CSS font stack of a font field. */
export function fontFamily(field: keyof typeof fontBases, font: string | undefined) {
  const value = font?.trim() ?? ""
  if (!value) return fontBases[field]
  const face = /^[\w-]+$/.test(value) ? value : `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  return `${face}, ${fontBases[field]}`
}
