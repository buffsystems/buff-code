// About (#462), ported from the Solid window's buff/about.tsx: Buff Code's version and links, and
// where it comes from — OpenCode, under the MIT license. The words are about-content.ts's.

import { aboutContent } from "@opencode/app/react-reuse/about-content"
import { useI18n } from "../../i18n/provider"
import { usePlatform } from "../../platform/context"

export function SettingsAbout() {
  const i18n = useI18n()
  const platform = usePlatform()
  const about = aboutContent(platform.version, i18n.buff.t, i18n.buff.locale)
  return (
    <div className="settings-about-content" data-component="buff-about">
      <span className="settings-about-wordmark ui-title ui-title--lg" aria-hidden="true">
        {i18n.buff.t("Buff Code")}
      </span>
      <div className="settings-about-intro">
        <p>{about.version}</p>
        <p>{about.description}</p>
      </div>
      <div className="settings-about-details">
        {about.links.map((link) => (
          <p key={link.href}>
            <a
              href={link.href}
              onClick={(event) => {
                event.preventDefault()
                platform.openExternal(link.href)
              }}
            >
              {link.label}
            </a>
          </p>
        ))}
      </div>
      <div className="settings-about-details settings-about-faint">
        {about.origin.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  )
}
