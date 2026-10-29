import HomeFooter from "../feature-plugins/home/footer"
import PromptBtw from "../feature-plugins/prompt/btw"
import PromptFooter from "../feature-plugins/prompt/footer"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import Notifications from "../feature-plugins/system/notifications"
import Plugins from "../feature-plugins/system/plugins"
import Storybook from "../feature-plugins/system/storybook"
import Stats from "../feature-plugins/system/stats"
import Latex from "@opencode/latex/plugin"
import Merman from "@opencode/merman/plugin"
import BuffContext from "../feature-plugins/buff/context"
import BuffLocale from "../feature-plugins/buff/locale"
import BuffMcp from "../feature-plugins/buff/mcp"
import BuffSkill from "../feature-plugins/buff/skill"
import BuffCustom from "../feature-plugins/buff/custom"
import BuffMemory from "../feature-plugins/buff/memory"
import BuffHook from "../feature-plugins/buff/hook"
import BuffPermissionMode from "../feature-plugins/buff/permission-mode"
import BuffGit from "../feature-plugins/buff/git"
import BuffBilling from "../feature-plugins/buff/billing"
import BuffAutomation from "../feature-plugins/buff/automation"
import BuffPhone from "../feature-plugins/buff/phone"
import BuffWorkflow from "../feature-plugins/buff/workflow"
import BuffTodo from "../feature-plugins/buff/todo"
import BuffGoal from "../feature-plugins/buff/goal"
import BuffSide from "../feature-plugins/buff/side"
import BuffQueries from "../feature-plugins/buff/queries"

export const builtins = [
  HomeFooter,
  // Buff: язык — общий с окном (#472).
  BuffLocale,
  // Buff: рабочий контекст — организация, проект, пространства (#391).
  BuffContext,
  // Buff: MCP-серверы — добавить, изменить, удалить (#444).
  BuffMcp,
  BuffSkill,
  BuffCustom,
  BuffMemory,
  BuffHook,
  BuffPermissionMode,
  BuffGit,
  // Buff: остаток организации и свой расход (#455).
  BuffBilling,
  // Buff: задачи агенту по расписанию (#447).
  BuffAutomation,
  BuffPhone,
  // Buff: сценарии — субагенты по фазам (#448).
  BuffWorkflow,
  // Buff: список дел — строка прогресса и /todos (#463).
  BuffTodo,
  // Buff: цель сессии — строка над полем ввода, пауза/продолжить/сбросить (#463).
  BuffGoal,
  // Buff: побочный диалог — /side открывает ответвление вкладкой (#464).
  BuffSide,
  // Buff: карта запросов — «Перейти к запросу», /queries (#465).
  BuffQueries,
  PromptFooter,
  PromptBtw,
  SidebarContext,
  SidebarMcp,
  SidebarFooter,
  Notifications,
  Plugins,
  Stats,
  Merman,
  Latex,
  // The storybook is a development tool; keep its route and palette commands out of
  // normal launches and register it only for OPENCODE_STORY runs.
  ...(process.env.OPENCODE_STORY ? [Storybook] : []),
  DiffViewer,
]
