// The settings pages' icons (#584): lucide glyphs for the Solid window's page icons.

import {
  Bell,
  Cpu,
  FlaskConical,
  Folder,
  GitBranch,
  Info,
  Keyboard,
  Palette,
  Plug,
  Puzzle,
  Server,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react"
import type { TranslationKey } from "../i18n/i18n"
import type { SettingsRootTab } from "./surface"

export const pageIcons: Record<SettingsRootTab, LucideIcon> = {
  general: SlidersHorizontal,
  appearance: Palette,
  notifications: Bell,
  shortcuts: Keyboard,
  projects: Folder,
  workspaces: GitBranch,
  providers: Plug,
  models: Cpu,
  extensions: Puzzle,
  servers: Server,
  experimental: FlaskConical,
  about: Info,
}

export const pageLabels = {
  general: "settings.tab.preferences",
  appearance: "settings.general.section.appearance",
  notifications: "settings.tab.notifications",
  shortcuts: "settings.shortcuts.title",
  projects: "settings.tab.projects",
  workspaces: "settings.tab.workspaces",
  providers: "settings.providers.title",
  models: "settings.models.title",
  extensions: "settings.tab.extensions",
  servers: "settings.section.server",
  experimental: "settings.tab.experimental",
  about: "settings.tab.about",
} as const satisfies Record<SettingsRootTab, TranslationKey>
