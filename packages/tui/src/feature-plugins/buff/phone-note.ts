import { BuffMobile } from "@opencode/schema/buff-mobile"
import { t } from "./locale-state"

/** Пометка в списке сессий консоли (#640): сессия начата с телефона — с какого. */
export function phoneNote(session: { readonly metadata?: unknown }): string | undefined {
  const origin = BuffMobile.phoneOrigin(session.metadata)
  if (!origin) return undefined
  return origin.device ? t("from the phone «{device}»", { device: origin.device }) : t("from the phone")
}

/**
 * What the console asks when a phone claimed the offer (#640). By QR the phone shows no code —
 * the QR carried the secret — so the person confirms the phone itself; by link and code both
 * screens show the same six digits to compare.
 */
export function pairConfirm(
  kind: "qr" | "code",
  phone: string,
  sas: string,
): { prompt: string; code?: string; keys: string } {
  if (kind === "qr")
    return {
      prompt: t("The phone «{name}» asks to connect by the QR code. If it is your phone, press Enter.", { name: phone }),
      keys: t("Enter — it is my phone · n — not my phone"),
    }
  return {
    prompt: t("The phone «{name}» shows a code. If it is the same as this one, press Enter.", { name: phone }),
    code: sas.replace(/^(\d{3})(\d{3})$/, "$1 $2"),
    keys: t("Enter — it matches · n — not my phone"),
  }
}
