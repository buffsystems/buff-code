import type { Page } from "./page-nav"

/** Наши страницы с входом в заголовке окна (#447, #448); название — английская строка, переводит вход (#472). */

export const AUTOMATIONS: Page = {
  path: "/automations",
  route: "automations",
  title: "Automations",
  icon: "refresh",
  action: "buff-automations",
}

export const WORKFLOWS: Page = {
  path: "/workflows",
  route: "workflows",
  title: "Workflows",
  icon: "branch-out",
  action: "buff-workflows",
}
