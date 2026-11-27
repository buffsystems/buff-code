// An agent in words (#972, TX-02). The engine names its agents by id — «build», «plan»; a person
// knows them as the work modes. An agent of the person's own keeps the name they gave it.

import { BuffSetup } from "@opencode/schema/buff-setup"

const WORDS: Record<string, string> = {
  build: "Work",
  plan: "Plan",
  [BuffSetup.AGENT]: "Self-setup",
}

/** `t` is Buff's own translation (English source). */
export function agentLabel(name: string, t: (text: string) => string): string {
  const word = WORDS[name]
  return word ? t(word) : name
}
