import { expect, test } from "bun:test"
import { catalogReadiness } from "./use-catalog"

// #966: the integrations load apart from the providers; until they have, a Buff account's sign-in
// is unknown — the chip must not read that as «signed out» and open the company sign-in.
test("the catalog is ready with providers and models; the sign-ins are known only once loaded", () => {
  expect(catalogReadiness({ providers: undefined, models: [], integrations: [] })).toEqual({ ready: false, integrationsReady: true })
  expect(catalogReadiness({ providers: [], models: [], integrations: undefined })).toEqual({ ready: true, integrationsReady: false })
  expect(catalogReadiness({ providers: [], models: [], integrations: [] })).toEqual({ ready: true, integrationsReady: true })
})
