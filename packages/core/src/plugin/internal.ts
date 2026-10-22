export * as PluginInternal from "./internal.js"

import { LLMClient } from "@opencode/ai"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { AppProcess } from "@opencode/util/process"
import { Context, Effect, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Agent } from "../agent.js"
import { Model } from "../model.js"
import { ModelResolver } from "../model-resolver.js"
import { Provider } from "../provider.js"
import { Command } from "../command.js"
import { Config } from "../config.js"
import { Credential } from "../credential.js"
import { llmClient } from "../effect/app-node-platform.js"
import { ConfigAgentPlugin } from "../config/plugin/agent.js"
import { ConfigCommandPlugin } from "../config/plugin/command.js"
import { ConfigCompactionPlugin } from "../config/plugin/compaction.js"
import { ConfigFormatterPlugin } from "../config/plugin/formatter.js"
import { ConfigImagePlugin } from "../config/plugin/image.js"
import { ConfigInstructionPlugin } from "../config/plugin/instruction.js"
import { ConfigLocationWatcherPlugin } from "../config/plugin/location-watcher.js"
import { ConfigMcpPlugin } from "../config/plugin/mcp.js"
import { ConfigProviderPlugin } from "../config/plugin/provider.js"
import { ConfigPolicyPlugin } from "../config/plugin/policy.js"
import { ConfigReferencePlugin } from "../config/plugin/reference.js"
import { ConfigShellPlugin } from "../config/plugin/shell.js"
import { ConfigSnapshotPlugin } from "../config/plugin/snapshot.js"
import { ConfigSkillPlugin } from "../config/plugin/skill.js"
import { ConfigCompatibilityPlugin } from "../config/plugin/compatibility.js"
import { ConfigToolOutputPlugin } from "../config/plugin/tool-output.js"
import { ConfigWebSearchPlugin } from "../config/plugin/websearch.js"
import { ConfigWorktreePlugin } from "../config/plugin/worktree.js"
import { Worktree } from "../worktree.js"
import { WorktreeStrategies } from "../worktree/strategies.js"
import { Bus } from "../bus.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileMutation } from "../file-mutation.js"
import { Formatter } from "../formatter.js"
import { Form } from "../form.js"
import { FileSystem } from "../filesystem.js"
import { LocationWatcherPolicy } from "../filesystem/location-watcher-policy.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Image } from "../image.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Integration } from "../integration.js"
import { Job } from "../job.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { ModelsDev } from "../models-dev.js"
import { Mcp } from "../mcp/index.js"
import { Npm } from "@opencode/util/npm"
import { Permission } from "../permission.js"
import { Reference } from "../reference.js"
import { WebSearch } from "../websearch.js"
import { Ripgrep } from "../ripgrep.js"
import { Session } from "../session.js"
import { SessionCompaction } from "../session/compaction.js"
import { SessionInstructions } from "../session/instructions.js"
import { Shell } from "../shell.js"
import { ShellSelect } from "../shell/select.js"
import { Snapshot } from "../snapshot.js"
import { Skill } from "../skill.js"
import { SkillDiscovery } from "../skill/discovery.js"
import { Watcher } from "../filesystem/watcher.js"
import { PatchTool } from "../tool/plugin/patch.js"
import { EditTool } from "../tool/plugin/edit.js"
import { GlobTool } from "../tool/plugin/glob.js"
import { GrepTool } from "../tool/plugin/grep.js"
import { OpenCodeTools } from "../tool/plugin/opencode.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { ReadToolFileSystem } from "../tool/read-filesystem.js"
import { ReadTool } from "../tool/plugin/read.js"
import { ShellTool } from "../tool/plugin/shell.js"
import { SkillTool } from "../tool/plugin/skill.js"
import { SubagentTool } from "../tool/plugin/subagent.js"
import { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"
import { WebFetchTool } from "../tool/plugin/webfetch.js"
import { WebSearchTool } from "../tool/plugin/websearch.js"
import { WellKnown } from "../wellknown.js"
import { WriteTool } from "../tool/plugin/write.js"
import { AgentPlugin } from "./agent.js"
import BrowserPlugin from "@opencode/plugin-browser"
import { CommandPlugin } from "./command.js"
import { NativeCompactionPlugin } from "./compaction.js"
import { IdentityPlugin } from "./identity.js"
import { PlanPlugin } from "./plan.js"
import { ModelsDevPlugin } from "./models-dev.js"
import { McpCodeModeExclusionPlugin } from "./mcp-codemode-exclusion.js"
import { ProviderPlugins } from "./provider.js"
import { BuffBrand } from "../buff/brand.js"
import { BuffGitSeen } from "../buff/gitseen.js"
import { BuffMcpPlugin } from "../buff/mcp.js"
import { BuffProviderPlugin } from "../buff/provider.js"
import { BuffSkillPlugin } from "../buff/skill.js"
import { BuffCustomPlugin } from "../buff/custom.js"
import { BuffMemoryPlugin } from "../buff/memory.js"
import { BuffHookPlugin } from "../buff/hook.js"
import { BuffTurnPlugin } from "../buff/turn.js"
import { BuffRequestHeaders } from "../buff/request-headers.js"
import { BuffSessionMarksPlugin } from "../buff/session-marks.js"
import { BuffLocale } from "../buff/locale.js"
import { BuffSearchPlugin } from "../buff/search.js"
import { BuffBackgroundStop } from "../buff/background.js"
import { BuffTrust } from "../buff/trust.js"
import { BuffAutomationPlugin } from "../buff/automation.js"
import { BuffAutomationService } from "../buff/automation-service.js"
import { BuffTodoPlugin } from "../buff/todo.js"
import { BuffPlanPlugin } from "../buff/plan.js"
import { BuffGoalPlugin } from "../buff/goal.js"
import { BuffSidePlugin } from "../buff/side.js"
import { BuffGoalService } from "../buff/goal-service.js"
import { BuffWorkflowPlugin } from "../buff/workflow.js"
import { BuffWorkflowService } from "../buff/workflow-service.js"
import { BuffGitPlugin } from "../buff/git.js"
import { BuffSnapshotGitPlugin } from "../buff/snapshot-git.js"
import { Database } from "../database/database.js"
import { BuffLogin } from "../buff/login.js"
import { BuffWorkContext } from "../buff/context.js"
import { WebSearchPlugins } from "./websearch/index.js"
import { SkillPlugin } from "./skill.js"
import { VcsHgPlugin } from "./vcs/hg.js"
import { ToolInputRepairPlugin } from "./tool-input-repair.js"
import { OptimizePlugin } from "./optimize.js"
import { VcsGitPlugin } from "./vcs/git.js"
import { WarmingPlugin } from "./warming.js"
import { WellKnownPlugin } from "../wellknown/plugin.js"

const services = [
  // Buff (#453): поиск по тексту переписки читает сообщения из базы.
  Database.Service,
  // Buff (#447): автоматизации — служба процесса, плагин каталога только передаёт.
  BuffAutomationService.Service,
  // Buff (#448): сценарии — служба процесса, плагин каталога только передаёт.
  BuffWorkflowService.Service,
  // Buff (#463): цели сессий — служба процесса.
  BuffGoalService.Service,
  Agent.Service,
  AppProcess.Service,
  Provider.Service,
  Model.Service,
  Command.Service,
  Config.Service,
  Credential.Service,
  Bus.Service,
  Environment.Service,
  FileAccess.Service,
  FileMutation.Service,
  Formatter.Service,
  LocationWatcherPolicy.Service,
  FileSystem.Service,
  FSUtil.Service,
  Global.Service,
  HttpClient.HttpClient,
  Image.Service,
  InstructionDiscovery.Service,
  Integration.Service,
  Job.Service,
  KV.Service,
  LLMClient.Service,
  Location.Service,
  ModelsDev.Service,
  ModelResolver.Service,
  Mcp.Service,
  Npm.Service,
  Permission.Service,
  Form.Service,
  ReadToolFileSystem.Service,
  Reference.Service,
  WebSearch.Service,
  Ripgrep.Service,
  Session.Service,
  SessionCompaction.Service,
  SessionInstructions.Service,
  Shell.Service,
  ShellSelect.Service,
  Snapshot.Service,
  Skill.Service,
  SkillDiscovery.Service,
  Tool.Service,
  ToolOutput.Service,
  Watcher.Service,
  WellKnown.Service,
  Worktree.Service,
  WorktreeStrategies.Service,
] as const

export type Requirements = Context.Service.Identifier<(typeof services)[number]>

export const requirements = LayerNode.group([
  Database.node,
  BuffAutomationService.node,
  BuffWorkflowService.node,
  BuffGoalService.node,
  Agent.node,
  AppProcess.node,
  Provider.node,
  Model.node,
  Command.node,
  Config.node,
  Credential.node,
  Bus.node,
  Environment.node,
  FileAccess.node,
  FileMutation.node,
  Formatter.node,
  LocationWatcherPolicy.node,
  FileSystem.node,
  FSUtil.node,
  Global.node,
  httpClient,
  Image.node,
  InstructionDiscovery.node,
  Integration.node,
  Job.node,
  KV.node,
  llmClient,
  Location.node,
  ModelsDev.node,
  ModelResolver.node,
  Mcp.node,
  Npm.node,
  Permission.node,
  Form.node,
  ReadToolFileSystem.node,
  Reference.node,
  WebSearch.node,
  Ripgrep.node,
  Session.node,
  SessionCompaction.node,
  SessionInstructions.node,
  Shell.node,
  ShellSelect.node,
  Snapshot.node,
  Skill.node,
  SkillDiscovery.node,
  Tool.node,
  ToolOutput.node,
  Watcher.node,
  WellKnown.node,
  Worktree.node,
  WorktreeStrategies.node,
])

export type InternalPlugin = Plugin<Requirements | Scope.Scope>

const pre = [
  ToolInputRepairPlugin.Plugin,
  ConfigWorktreePlugin.Plugin,
  BrowserPlugin,
  ConfigMcpPlugin.Plugin,
  McpCodeModeExclusionPlugin.Plugin,
  WellKnownPlugin.Plugin,
  VcsGitPlugin.Plugin,
  AgentPlugin.Plugin,
  PlanPlugin.Plugin,
  CommandPlugin.Plugin,
  SkillPlugin.Plugin,
  VcsHgPlugin.Plugin,
  ModelsDevPlugin,
  NativeCompactionPlugin.Plugin,
  ...ProviderPlugins,
  BuffLogin.Plugin,
  BuffWorkContext.Plugin,
  BuffGitSeen.Plugin,
  BuffMcpPlugin.Plugin,
  BuffProviderPlugin.Plugin,
  ...WebSearchPlugins,
  PatchTool.Plugin,
  // Render model prompts after the patch plugin selects the available editing tools.
  ...OptimizePlugin.Plugins,
  IdentityPlugin.Plugin,
  EditTool.Plugin,
  GlobTool.Plugin,
  GrepTool.Plugin,
  OpenCodeTools.Plugin,
  QuestionTool.Plugin,
  ReadTool.Plugin,
  ShellTool.Plugin,
  SkillTool.Plugin,
  SubagentTool.Plugin,
  WebFetchTool.Plugin,
  WebSearchTool.Plugin,
  WriteTool.Plugin,
  WarmingPlugin.Plugin,
] as const satisfies readonly InternalPlugin[]

const post = [
  ConfigInstructionPlugin.Plugin,
  ConfigReferencePlugin.Plugin,
  ConfigAgentPlugin.Plugin,
  ConfigCommandPlugin.Plugin,
  ConfigCompactionPlugin.Plugin,
  ConfigFormatterPlugin.Plugin,
  ConfigImagePlugin.Plugin,
  ConfigLocationWatcherPlugin.Plugin,
  ConfigShellPlugin.Plugin,
  ConfigSnapshotPlugin.Plugin,
  ConfigToolOutputPlugin.Plugin,
  ConfigCompatibilityPlugin.Plugin,
  ConfigSkillPlugin.Plugin,
  ConfigProviderPlugin.Plugin,
  ConfigWebSearchPlugin.Plugin,
  ConfigPolicyPlugin.Plugin,
  // Buff (#445): последним — выключенный навык убирается из реестра после того, как его добавили.
  BuffSkillPlugin.Plugin,
  BuffCustomPlugin.Plugin,
  BuffMemoryPlugin.Plugin,
  BuffHookPlugin.Plugin,
  BuffTurnPlugin.Plugin,
  BuffRequestHeaders.Plugin,
  BuffSessionMarksPlugin.Plugin,
  // Buff (#472): язык — один на окно, консоль и ядро.
  BuffLocale.Plugin,
  BuffSearchPlugin.Plugin,
  BuffGitPlugin.Plugin,
  BuffSnapshotGitPlugin.Plugin,
  BuffBackgroundStop.Plugin,
  BuffTrust.Plugin,
  BuffAutomationPlugin.Plugin,
  BuffWorkflowPlugin.Plugin,
  BuffTodoPlugin.Plugin,
  BuffPlanPlugin.Plugin,
  BuffGoalPlugin.Plugin,
  BuffSidePlugin.Plugin,
] as const satisfies readonly InternalPlugin[]

export const list = Effect.fn("PluginInternal.list")(function* () {
  // Capture only services; activation supplies the child Scope and batching context.
  const context = Context.pick(...services)(yield* Effect.context<Requirements>())
  const resolve = (plugins: readonly InternalPlugin[]) =>
    plugins.filter(BuffBrand.keepPlugin).map(
      (plugin): Plugin => ({
        id: plugin.id,
        effect: (host) => plugin.effect(host).pipe(Effect.provide(context)),
      }),
    )
  return {
    pre: resolve(pre),
    post: resolve(post),
  }
})
