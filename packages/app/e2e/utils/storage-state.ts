// The specs assert upstream's defaults, which the Buff fork deliberately changed. Every test context
// starts with those defaults chosen through the window's own persisted settings, which both the Solid
// and the React windows read before their first render. A spec that stores its own value overrides it.
//
// - Language (#471): the window starts in Russian; the specs assert the English source names.
// - Session tabs (#470): the window starts with the vertical session column; the specs drive the
//   titlebar tabs, and the vertical-tab specs choose that layout themselves.
export const LANGUAGE_KEY = "opencode.global.dat:language"
export const SETTINGS_KEY = "settings.v3"

export function upstreamStorageState(baseURL: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: LANGUAGE_KEY, value: JSON.stringify({ locale: "en" }) },
          { name: SETTINGS_KEY, value: JSON.stringify({ appearance: { tabLayout: "horizontal" } }) },
        ],
      },
    ],
  }
}
