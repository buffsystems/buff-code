import { For } from "solid-js"
import { Logo } from "@opencode/ui/logo"
import { usePlatform } from "@/runtime/platform/platform"
import { ExternalLink } from "@/runtime/platform/external-link"
import { aboutContent } from "./about-content"
import { useBuffText } from "./i18n"

/** Страница «About» настроек (#462); что на ней написано — в `about-content.ts`. */
export function BuffAbout() {
  const platform = usePlatform()
  const { t, locale } = useBuffText()
  const about = () => aboutContent(platform.version, t, locale())
  return (
    <div class="settings-about-content" data-component="buff-about">
      <Logo class="settings-about-wordmark" />
      <div class="settings-about-intro">
        <p>{about().version}</p>
        <p>{about().description}</p>
      </div>
      <div class="settings-about-details">
        <For each={about().links}>
          {(link) => (
            <p>
              <ExternalLink href={link.href}>{link.label}</ExternalLink>
            </p>
          )}
        </For>
      </div>
      <div class="settings-about-details settings-about-faint">
        <For each={about().origin}>{(line) => <p>{line}</p>}</For>
      </div>
    </div>
  )
}
