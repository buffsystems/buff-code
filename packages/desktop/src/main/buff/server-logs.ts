// Buff: the CLI keeps its state under the renamed directory (packages/util/src/global.ts), so the
// desktop looks there too — for the service registration and the server logs it exports.
declare const BUFF_APP_DIR: string | undefined
export const appDir = typeof BUFF_APP_DIR === "string" ? BUFF_APP_DIR : "buff"

export function serverLogRoots(join: (...parts: string[]) => string, xdgData: string, userData: string) {
  return [...new Set([join(xdgData, appDir, "log"), join(userData, appDir, "log")])]
}
