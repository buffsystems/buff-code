// Buff (#584): the background service outlives the app, so it must not keep the app's descriptors.
// On Linux libuv's spawn closes nothing beyond the child's stdio: the service got every descriptor
// the Electron main process had open without close-on-exec — the crash reporter's client socket
// (chrome_crashpad_handler then lives as long as the service), the DevTools connection, Chromium's
// pak and LevelDB files. macOS (posix_spawn with POSIX_SPAWN_CLOEXEC_DEFAULT) and Windows (only
// handles marked inheritable) do not hand them over.
//
// The command runs through bash, which closes every descriptor above stderr and execs the service:
// same pid (the registration names it), same stdio (the client's stderr pipe reports a failed
// start), nothing else. The service keeps writing its own log file.

import { existsSync } from "node:fs"

const BASH = "/bin/bash"

// The glob lists the shell's descriptors once; the one it read the directory with is closed by then,
// hence the -e check. `exec {fd}>&-` closes a descriptor above 9 (bash 4.1+).
const CLOSE_INHERITED =
  'for fd in /proc/$$/fd/*; do fd=${fd##*/}; [ "$fd" -gt 2 ] && [ -e "/proc/$$/fd/$fd" ] && exec {fd}>&-; done; exec "$@"'

export function serviceCommand(command: string[], platform: NodeJS.Platform = process.platform, bash = BASH) {
  if (platform !== "linux" || !existsSync(bash)) return command
  return [bash, "-c", CLOSE_INHERITED, "buff-service", ...command]
}
