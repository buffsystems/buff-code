// Buff (#880): the window waits for its local server; when the server never comes (a busy service
// port, a crash), the splash gave way to nothing and stayed forever. Now the window says why.
import { BuffI18n } from "@opencode/schema/buff-i18n"

/** The words of the failure: the deepest cause's — past the IPC and Effect wrappers — the service's own. */
export function startupErrorReason(error: unknown): string {
  const words = (value: unknown): string | undefined =>
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "message" in value && typeof value.message === "string"
        ? value.message
        : undefined
  let said = words(error) ?? String(error)
  let at: unknown = error
  for (let depth = 0; depth < 8 && at instanceof Error && at.cause !== undefined; depth++) {
    at = at.cause
    said = words(at) ?? said
  }
  return said
}

/** In place of the splash: what failed, what to do, and a retry that starts the wait again. */
export function showStartupError(root: HTMLElement, error: unknown, language: string): void {
  const lang = BuffI18n.systemLocale([language])
  const t = {
    title: BuffI18n.t(lang, "Buff Code's local server did not start"),
    hint: BuffI18n.t(
      lang,
      "If another program holds the service port, pick another one: buff service set port <port>, then «Retry».",
    ),
    retry: BuffI18n.t(lang, "Retry"),
  }
  const box = document.createElement("div")
  box.setAttribute("role", "alert")
  box.dataset.component = "startup-error"
  box.style.cssText =
    "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;font:14px/1.5 system-ui,sans-serif"
  const title = document.createElement("h1")
  title.textContent = t.title
  title.style.cssText = "font-size:18px;font-weight:600;margin:0"
  const reason = document.createElement("pre")
  reason.textContent = startupErrorReason(error)
  reason.style.cssText = "max-width:640px;white-space:pre-wrap;opacity:.8;margin:0;font:12px/1.5 ui-monospace,monospace"
  const hint = document.createElement("p")
  hint.textContent = t.hint
  hint.style.cssText = "max-width:520px;opacity:.7;margin:0"
  const retry = document.createElement("button")
  retry.textContent = t.retry
  retry.style.cssText = "padding:8px 16px;border-radius:8px;border:1px solid currentColor;background:none;color:inherit;cursor:pointer"
  retry.onclick = () => location.reload()
  box.append(title, reason, hint, retry)
  root.replaceChildren(box)
}
