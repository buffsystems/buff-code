import { LocaleProvider } from "@buff/ui/react"
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react"
import { createPersisted } from "../core/persisted"
import type { PlatformStorage } from "../platform/platform"
import { useStore } from "../react/use-store"
import {
  createTranslator,
  english,
  loadDictionary,
  normalizeLocale,
  type Dictionary,
  type Locale,
  type Translator,
} from "./i18n"

type I18n = Translator & { setLocale(locale: Locale): void }

const I18nContext = createContext<I18n | undefined>(undefined)

/**
 * The window's language, persisted where the Solid window keeps it (opencode.global.dat:language)
 * so both windows agree. The previous dictionary stays on screen until the next one has loaded.
 */
export function I18nProvider(props: { storage: PlatformStorage; initial?: Loaded; children?: ReactNode }) {
  const [language] = useState(() =>
    createPersisted({
      storage: props.storage,
      key: "language",
      decode: (raw) => ({ locale: normalizeLocale(readLocale(raw)) }),
      initial: { locale: props.initial?.locale ?? normalizeLocale(undefined) },
    }),
  )
  const locale = useStore(language.store, (state) => state.locale)
  const [loaded, setLoaded] = useState<Loaded>(props.initial ?? { locale: "en", dictionary: english })

  useEffect(() => {
    const current = { cancelled: false }
    void loadDictionary(locale).then((dictionary) => {
      if (!current.cancelled) setLoaded({ locale, dictionary })
    })
    return () => {
      current.cancelled = true
    }
  }, [locale])

  useEffect(() => {
    document.documentElement.lang = loaded.locale
    document.documentElement.dir = "ltr"
  }, [loaded.locale])

  const value = useMemo<I18n>(
    () => ({
      ...createTranslator(loaded.locale, loaded.dictionary),
      setLocale: (next) => language.set(() => ({ locale: next })),
    }),
    [loaded, language],
  )
  // @buff/ui's own words (close, copy, cancel…) speak the window's language too (#713).
  return (
    <I18nContext value={value}>
      <LocaleProvider locale={loaded.locale}>{props.children}</LocaleProvider>
    </I18nContext>
  )
}

type Loaded = { locale: Locale; dictionary: Dictionary }

/** Read the stored language and load its dictionary before the first render, so no English flashes. */
export async function preloadLanguage(storage: PlatformStorage): Promise<Loaded> {
  const raw = await Promise.resolve(storage.getItem("language")).catch(() => null)
  const locale = normalizeLocale(raw ? safeLocale(raw) : undefined)
  return { locale, dictionary: await loadDictionary(locale) }
}

export function useI18n() {
  const i18n = use(I18nContext)
  if (!i18n) throw new Error("useI18n must be used inside I18nProvider")
  return i18n
}

function safeLocale(raw: string) {
  try {
    return readLocale(raw)
  } catch {
    return undefined
  }
}

function readLocale(raw: string) {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== "object" || value === null || !("locale" in value)) return undefined
  return typeof value.locale === "string" ? value.locale : undefined
}
