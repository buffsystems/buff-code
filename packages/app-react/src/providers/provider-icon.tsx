// A provider's mark (#584): the Solid window's provider sprite, by provider id; an unknown
// provider gets the generic mark. An app-specific glyph set, so it lives here, not in @buff/ui.

import sprite from "@opencode/ui/icons/provider-sprite.svg"
import { iconNames } from "@opencode/ui/icons/provider"

const known = new Set<string>(iconNames)

export function ProviderIcon(props: { id: string; size?: number; className?: string }) {
  const size = props.size ?? 16
  return (
    <svg
      data-component="provider-icon"
      aria-hidden="true"
      width={size}
      height={size}
      className={["shrink-0", props.className].filter(Boolean).join(" ")}
    >
      <use href={`${sprite}#${known.has(props.id) ? props.id : "synthetic"}`} />
    </svg>
  )
}
