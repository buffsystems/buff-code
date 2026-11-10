import type { SessionInbox } from "@opencode/schema/session-inbox"

/**
 * Buff (#805): what Enter does with a prompt. While the agent works the prompt waits for the
 * end of its turn (queue); a prompt that cannot be queued (shell, slash command, exit), or one
 * sent to an idle session, goes at once — as before. «Send now» (steer) is its own keybind.
 */
export function enterDelivery(input: { running: boolean; queueable: boolean }): SessionInbox.Delivery {
  return input.running && input.queueable ? "queue" : "steer"
}
