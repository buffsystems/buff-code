import { test as base, type BrowserContext } from "@playwright/test"

export * from "@playwright/test"

const offline = new WeakMap<BrowserContext, boolean>()

/**
 * Serve the app under test to the page through Playwright instead of Chromium's socket pool.
 *
 * Chromium flushes its socket pools with ERR_NETWORK_CHANGED on any IP address change of the host
 * (TransportClientSocketPool::OnIPAddressChanged), loopback included, and no switch turns that off.
 * On a host whose interfaces churn (container bridges and veths) a page then loses an app chunk and
 * stays blank. Requests to the app's origin are fetched by the test process and fulfilled, so no
 * Chromium socket is involved; routes a spec registers itself still take precedence.
 *
 * A request a service worker answers never reaches the route, so worker semantics hold; the worker's
 * own network fetches are served like the page's. A fulfilled request skips Chromium's offline
 * emulation, so while `context.setOffline(true)` holds it fails as an offline browser's would.
 */
export async function serveAppThroughPlaywright(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin
  if (!offline.has(context)) {
    offline.set(context, false)
    const setOffline = context.setOffline.bind(context)
    context.setOffline = async (value) => {
      await setOffline(value)
      offline.set(context, value)
    }
  }
  await context.route(
    (url) => url.origin === origin,
    async (route) => {
      if (offline.get(context)) return route.abort("internetdisconnected")
      // A kept-alive connection the server already closed answers ECONNRESET: fetch again.
      return route.fulfill({ response: await route.fetch({ maxRetries: 2 }) })
    },
  )
}

/** Playwright's `test` with the app served through {@link serveAppThroughPlaywright}. */
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (baseURL) await serveAppThroughPlaywright(context, baseURL)
    await use(context)
    // A load still in flight when the test ends must not fail it after the fact.
    await context.unrouteAll({ behavior: "ignoreErrors" })
  },
})
