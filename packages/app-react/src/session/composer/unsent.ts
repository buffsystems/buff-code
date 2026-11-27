// What the person typed and did not send (#972). Rewinding to a request puts that request into
// the box; what was in the box is set aside and offered back at once — never thrown away.

import type { Prompt } from "@opencode/app/react-reuse/composer-schema"
import { appendPrompt, clonePrompt, isAttachment } from "@opencode/app/react-reuse/composer-prompt-parts"
import { showToast } from "../../shell/notifications/toast"

/** Whether a prompt holds anything of the person's: text that is not only spaces, or an attachment. */
export function hasUnsent(prompt: Prompt): boolean {
  return prompt.some((part) => (part.type === "text" ? part.content.trim() !== "" : true))
}

/** Says the unsent text was set aside and offers it back; `t` is Buff's own translation. */
export function offerUnsent(t: (text: string) => string, bringBack: () => void) {
  showToast({
    title: t("Your unsent text was set aside"),
    description: t("The box now holds the request you went back to."),
    persistent: true,
    actions: [
      { label: t("Bring my text back"), onClick: bringBack },
      { label: t("Leave as it is"), onClick: "dismiss" },
    ],
  })
}

/**
 * The box after «bring my text back» when the person has typed since: what stands there now,
 * then what was set aside. Mentions stay inside their sentences (they are parts of the text,
 * with places in it); files beside the text — of both — stay beside it. An empty side adds no
 * blank lines.
 */
export function joined(now: Prompt, kept: Prompt): Prompt {
  if (!hasText(now)) return [...clonePrompt(kept), ...now.filter(isAttachment)]
  if (!hasText(kept)) return [...clonePrompt(now), ...kept.filter(isAttachment)]
  return appendPrompt(now, kept)
}

function hasText(prompt: Prompt) {
  return prompt.some((part) => !isAttachment(part) && part.content.trim() !== "")
}
