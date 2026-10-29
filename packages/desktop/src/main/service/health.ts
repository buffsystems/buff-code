import { BuffServerAuth } from "@opencode/schema/buff-server-auth"

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  const headers = new Headers()
  if (password) {
    // Служба могла остаться от прежнего выпуска: прежнее имя понимают все.
    const auth = Buffer.from(`${BuffServerAuth.LEGACY_USERNAME}:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(new URL("/api/info", url), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
