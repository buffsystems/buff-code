/**
 * Экран «Providers» в Buff Code (#466). У апстрима подключённым считается провайдер, у которого
 * есть модели; у нас модели появляются после выбора рабочего контекста, а вход выполнен раньше.
 * Поэтому подключение — это вход: строка есть сразу, и из неё можно выйти.
 */
export const BUFF_PROVIDER = "buff"

interface Named {
  readonly id: string
  readonly name: string
}
interface Integration extends Named {
  readonly connections: readonly { readonly type: string; readonly label?: string }[]
}

/** Строка списка подключений; `pending` — вход выполнен, моделей ещё нет; `account` — чей вход (#470). */
export interface ConnectedRow extends Named {
  readonly pending: boolean
  readonly account?: string
}

const signedIn = (integration: Integration) => integration.connections.some((item) => item.type === "credential")

/** Выполнен ли вход в Buff (#457): от этого зависит, что говорит плашка «нет модели». */
export function buffSignedIn(integrations: readonly Integration[]): boolean {
  return integrations.some((integration) => integration.id === BUFF_PROVIDER && signedIn(integration))
}

export function connectedRows(providers: readonly Named[], integrations: readonly Integration[]): ConnectedRow[] {
  const listed = new Set(providers.map((provider) => provider.id))
  const account = (id: string) => {
    const label = integrations
      .find((integration) => integration.id === id)
      ?.connections.find((item) => item.type === "credential")?.label
    return label ? { account: label } : {}
  }
  return [
    ...providers.map(({ id, name }) => ({ id, name, pending: false, ...account(id) })),
    ...integrations
      .filter((integration) => signedIn(integration) && !listed.has(integration.id))
      .map(({ id, name }) => ({ id, name, pending: true, ...account(id) })),
  ]
}

/** Вход предлагается, пока его нет: других провайдеров в Buff Code не бывает. */
export function signInOffered(integrations: readonly Integration[]): boolean {
  return integrations.some((integration) => integration.id === BUFF_PROVIDER && !signedIn(integration))
}

/** Подпись способа подключения: вход в Buff — не ключ API; английская строка, переводит экран (#472). */
export function providerTag(id: string): string | undefined {
  return id === BUFF_PROVIDER ? "Sign-in through the connector" : undefined
}
