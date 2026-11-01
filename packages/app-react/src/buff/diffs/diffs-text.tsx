// The diff viewer's own words (#470) — «N unmodified lines», «No newline at end of file», «Expand
// all» — in the window's language: the library writes them in English, Buff's patch of it asks
// here, as the Solid window's locale sync arranged.

import { installDiffsText } from "@opencode/app/react-reuse/diffs-text"
import { useEffect, useRef } from "react"
import { useI18n } from "../../i18n/provider"

export function DiffsText() {
  const locale = useI18n().buff.locale
  const current = useRef(locale)
  current.current = locale
  useEffect(() => installDiffsText(() => current.current), [])
  return null
}
