import { retry, type RetryOptions } from "@opencode/util/retry"

/**
 * Keep a read going while its owner still wants it: a failed read does not prove the place is
 * missing, so it is retried with the shared backoff until it lands, runs out of attempts, or the
 * owner stops it (moved on, disconnected). Returns the stop. Used for a Location's reads and its
 * project's worktree inventory in both windows.
 */
export function readWhileCurrent(read: () => Promise<unknown>, options?: Pick<RetryOptions, "attempts" | "delay">) {
  let stale = false
  void retry(() => (stale ? Promise.resolve() : read()), { ...options, retryIf: () => !stale }).catch(() => undefined)
  return () => {
    stale = true
  }
}
