import { createResource, Match, Show, Switch, type JSX } from "solid-js"
import type { MediaKind } from "./file-content"
import { useBuffText } from "./i18n"
import "./file-preview.css"

/**
 * Показ файла по адресу (`blob:`/`data:`) — один для просмотра файлов проекта (#451) и для
 * вложений в поле ввода (#459): картинка, видео, звук, PDF или текст.
 */
export function BuffMediaView(props: { src: string; kind: MediaKind; title: string; fallback?: () => JSX.Element }) {
  const { t } = useBuffText()
  const [text] = createResource(
    () => (props.kind === "text" ? props.src : undefined),
    (src) => fetch(src).then((response) => response.text()),
  )
  return (
    <Switch fallback={props.fallback?.()}>
      <Match when={props.kind === "image"}>
        <img class="buff-preview-image" data-component="buff-preview-image" src={props.src} alt={props.title} />
      </Match>
      <Match when={props.kind === "pdf"}>
        <iframe class="buff-preview-pdf" data-component="buff-preview-pdf" src={props.src} title={props.title} />
      </Match>
      <Match when={props.kind === "video"}>
        <div class="px-6 py-4">
          {/* biome-ignore lint: у локального видео нет дорожки субтитров */}
          <video class="buff-preview-video" data-component="buff-preview-video" src={props.src} controls />
        </div>
      </Match>
      <Match when={props.kind === "audio"}>
        <div class="px-6 py-4">
          {/* biome-ignore lint: у локального звука нет дорожки субтитров */}
          <audio data-component="buff-preview-audio" src={props.src} controls />
        </div>
      </Match>
      <Match when={props.kind === "text"}>
        <Show when={text.latest !== undefined} fallback={<div class="px-6 py-4 text-text-weak">{t("Loading…")}</div>}>
          <pre class="buff-preview-text" data-component="buff-preview-text">
            {text.latest}
          </pre>
        </Show>
      </Match>
    </Switch>
  )
}
