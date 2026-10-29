// Buff (#639): домашняя установка машины. Buff Code со входом в Buff спрашивает через коннектор
// компании, какой пир ретранслятора — её дом (организация на buff.systems, сама установка в CE/EE)
// и запрещены ли там телефоны. Машина называет этот дом при регистрации, и шлюз применяет к ней
// его политику; сама машина при запрете не предлагает сопряжений и рвёт свои пары.

export interface Home {
  /** Пир ретранслятора, которого машина называет домом. */
  readonly peer: string
  /** Как человек знает эту установку: организация или адрес кабинета. */
  readonly name: string
  /** Организация на buff.systems или сама установка (CE/EE). */
  readonly kind: "saas" | "install"
  readonly forbidden: boolean
}

export interface SignedIn {
  readonly token: string
  readonly connector: string
}

/** Организации из токена разработчика: его полезная нагрузка, без проверки — проверяет бэкенд. */
export function tokenOrgs(token: string): string[] {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      orgs?: unknown
    }
    return Array.isArray(payload.orgs) ? payload.orgs.filter((org): org is string => typeof org === "string") : []
  } catch {
    return []
  }
}

type Post = (url: string, body: object) => Promise<{ status: number; json: unknown }>

/**
 * Дом машины: по каждой организации разработчика — ответ его установки. Запретившая телефоны
 * важнее: машина подчиняется ей. Коннектор, не знающий вопроса (старый), и молчащий — без дома.
 */
export async function lookupHome(me: SignedIn, post: Post): Promise<Home | null> {
  const homes: Home[] = []
  for (const org of tokenOrgs(me.token)) {
    const reply = await post(`${me.connector}/v1/developer/mobile-home`, { token: me.token, org }).catch(() => null)
    const body = (reply?.json ?? null) as {
      ok?: unknown
      home?: unknown
      kind?: unknown
      name?: unknown
      pairing_disabled?: unknown
    } | null
    if (!reply || reply.status >= 400 || body?.ok !== true || typeof body.home !== "string" || !body.home) continue
    homes.push({
      peer: body.home,
      name: typeof body.name === "string" ? body.name : org,
      kind: body.kind === "saas" ? "saas" : "install",
      forbidden: body.pairing_disabled === true,
    })
  }
  return homes.find((home) => home.forbidden) ?? homes[0] ?? null
}
