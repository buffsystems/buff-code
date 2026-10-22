// The tool renderer's contract (#584), as the Solid window's tool-renderer defines it.

import type { SessionMessageAssistantReasoning, SessionMessageAssistantTool } from "@opencode/client/promise"
import type { ReactNode } from "react"

export type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  tool: string
  sessionID?: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  deferContent?: boolean
  virtualizeDiff?: boolean
  onContentRendered?: () => void
  forceOpen?: boolean
  locked?: boolean
}

/** What a "Used N" group holds: tool calls, thoughts, and grouped shell commands or notices. */
export type ContextGroupPart =
  | SessionMessageAssistantTool
  | (SessionMessageAssistantReasoning & { id: string; streaming?: boolean })
  | { type: "notice" | "shell"; id: string; title?: string; render: () => ReactNode }

export type ContextToolGroupProps = {
  parts: ContextGroupPart[]
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
  reasoningDefaultOpen?: boolean
  reasoningOpen?: (id: string) => boolean | undefined
  onReasoningOpenChange?: (id: string, open: boolean) => void
  toolDefaultOpen?: (tool: SessionMessageAssistantTool) => boolean | undefined
  toolOpen?: (id: string) => boolean | undefined
  onToolOpenChange?: (id: string, open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  patchGroupKey?: (tools: SessionMessageAssistantTool[]) => string
}

export type FileToolGroupProps = {
  tools: SessionMessageAssistantTool[]
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  onSizeChange?: () => void
}
