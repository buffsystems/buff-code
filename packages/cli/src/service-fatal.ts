/**
 * The background service's last words (#880): `serve --service` runs without a terminal, and the
 * one who started it — the desktop window — reads only its stderr. Why it stopped goes there, one
 * line; an interactive command keeps its usual report.
 */
export function serviceFatalLine(args: readonly string[], failure: unknown): string | undefined {
  if (!(args.includes("serve") && args.includes("--service"))) return undefined
  return `${failure instanceof Error ? failure.message : String(failure)}\n`
}
