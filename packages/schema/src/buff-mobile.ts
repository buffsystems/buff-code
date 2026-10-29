export * as BuffMobile from "./buff-mobile.js"

import { Schema } from "effect"
import { define } from "./rpc.js"

/**
 * Телефон для Buff Code (#639, #640): сопряжение машины с телефоном через ретранслятор
 * buff.systems и список сопряжённых телефонов. Работу ведёт служба (`core/src/buff/mobile-service.ts`),
 * окно и консоль показывают её состояние и подтверждают сопряжение.
 */

export const Status = Schema.Struct({
  /** Шлюз, через который телефон достаёт машину. */
  gateway: Schema.String,
  connected: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
  phones: Schema.Number,
  /** Служба Buff Code запущена: без неё телефон до машины не дотянется. */
  running: Schema.Boolean,
  /** Установка, куда вошёл Buff Code (#639): её политика действует на машину; без входа — null. */
  home: Schema.NullOr(
    Schema.Struct({ name: Schema.String, kind: Schema.Literals(["saas", "install"]), forbidden: Schema.Boolean }),
  ),
})
export type Status = typeof Status.Type

export const Phone = Schema.Struct({
  device: Schema.String,
  display: Schema.String,
  paired: Schema.Number,
  online: Schema.Boolean,
  seen: Schema.NullOr(Schema.Number),
})
export type Phone = typeof Phone.Type

export const Offer = Schema.Struct({
  offerId: Schema.String,
  state: Schema.Literals(["offered", "claimed", "sas", "confirm", "paired", "failed"]),
  kind: Schema.Literals(["qr", "code"]),
  /** Ссылка для QR (или для ввода кода на телефоне). */
  link: Schema.String,
  code: Schema.optional(Schema.String),
  expiresAt: Schema.Number,
  phone: Schema.optional(Schema.String),
  /** Код сверки: на телефоне показан такой же — значит, сопрягается этот телефон. */
  sas: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})
export type Offer = typeof Offer.Type

/**
 * Сессия начата с телефона (#651 пишет это в её метаданные): с какого — имя телефона на тот момент;
 * иначе null. Окно и консоль по этому рисуют баннер и пометку в списке.
 */
export function phoneOrigin(metadata: unknown): { readonly device?: string } | null {
  if (typeof metadata !== "object" || metadata === null) return null
  const { origin, device } = metadata as { origin?: unknown; device?: unknown }
  if (origin !== "phone") return null
  return typeof device === "string" && device ? { device } : {}
}

/** Сопряжение ещё идёт: окно и консоль спрашивают службу, как оно движется. */
export const isLive = (offer: Offer | null | undefined): boolean =>
  !!offer &&
  (offer.state === "offered" || offer.state === "claimed" || offer.state === "sas" || offer.state === "confirm")

const portable = Schema.toStandardSchemaV1
const Nothing = portable(Schema.Undefined)
const Failures = { refused: portable(Schema.Struct({})) }
const ById = portable(Schema.Struct({ offerId: Schema.String }))

export const Rpc = define({
  id: "buff.mobile",
  methods: {
    status: { input: Nothing, output: portable(Status), errors: Failures },
    phones: { input: Nothing, output: portable(Schema.Array(Phone)), errors: Failures },
    /** Начать сопряжение: QR (полная энтропия) или ссылка с кодом. */
    offer: { input: portable(Schema.Struct({ kind: Schema.Literals(["qr", "code"]) })), output: portable(Offer), errors: Failures },
    view: { input: ById, output: portable(Offer), errors: Failures },
    /** Начатые и идущие сопряжения — экран телефона открылся снова. */
    offers: { input: Nothing, output: portable(Schema.Array(Offer)), errors: Failures },
    /** Человек подтвердил на компьютере: код сверки совпал, телефон его. */
    confirm: { input: ById, output: portable(Offer), errors: Failures },
    cancel: { input: ById, output: portable(Schema.Struct({})), errors: Failures },
    revoke: { input: portable(Schema.Struct({ device: Schema.String })), output: portable(Schema.Struct({})), errors: Failures },
    rename: {
      input: portable(Schema.Struct({ device: Schema.String, display: Schema.String })),
      output: portable(Schema.Struct({})),
      errors: Failures,
    },
  },
  events: { changed: { schema: portable(Schema.Struct({})) } },
})

export type AppStore = "app-store" | "google-play" | "rustore" | "appgallery" | "apk"
export type AppLink = { readonly store: AppStore; readonly name: string; readonly url: string }

/**
 * Where to get the Buff app (#704): the gateway's site pages — each sends to the store's page, or to
 * the newest APK on GitHub (`buff-<version>.apk` of the buff-community releases), or to the
 * site's download section while a store is not published yet. Buff Code keeps no store addresses.
 */
export function appLinks(gateway: string): AppLink[] {
  const site = `https://${gateway}/mobile`
  return [
    { store: "app-store", name: "App Store", url: `${site}/app-store` },
    { store: "google-play", name: "Google Play", url: `${site}/google-play` },
    { store: "rustore", name: "RuStore", url: `${site}/rustore` },
    { store: "appgallery", name: "AppGallery", url: `${site}/appgallery` },
    { store: "apk", name: "APK", url: `${site}/android-apk` },
  ]
}
