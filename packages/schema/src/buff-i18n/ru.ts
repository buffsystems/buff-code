import type { Catalog } from "../buff-i18n.js"
import { account } from "./ru-account.js"
import { automations } from "./ru-automations.js"
import { cli } from "./ru-cli.js"
import { cliErrors } from "./ru-cli-errors.js"
import { cliHelp } from "./ru-cli-help.js"
import { cliWizard } from "./ru-cli-wizard.js"
import { consoleApp } from "./ru-console-app.js"
import { consolePrompt } from "./ru-console-prompt.js"
import { consoleConfig } from "./ru-console-config.js"
import { consoleDialogs } from "./ru-console-dialogs.js"
import { consoleSession } from "./ru-console-session.js"
import { consoleMini } from "./ru-console-mini.js"
import { extensions } from "./ru-extensions.js"
import { phone } from "./ru-phone.js"
import { session } from "./ru-session.js"
import { sessions } from "./ru-sessions.js"
import { workflows } from "./ru-workflows.js"

/** Русский каталог Buff (#472) по областям; ключ — английская строка из кода. */
export const AREAS: Readonly<Record<string, Catalog>> = {
  sessions,
  automations,
  workflows,
  extensions,
  session,
  account,
  cli,
  cliHelp,
  cliErrors,
  cliWizard,
  consoleApp,
  consolePrompt,
  consoleConfig,
  consoleDialogs,
  consoleSession,
  consoleMini,
  phone,
}

export const RU: Catalog = Object.assign({}, ...Object.values(AREAS))
