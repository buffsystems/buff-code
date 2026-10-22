// A project's mark (#584): the project's own icon when it has one, otherwise its name's initial on
// its colour, or the spinner while the session it stands for is working. Shared by tabs, Home and
// the session list.

import { Avatar, avatarColor, avatarColors, nameColor, Spinner } from "@buff/ui/react"
import type { CSSProperties } from "react"
import { useI18n } from "../i18n/provider"

/** A project's icon as the server reports it (the Solid window's ProjectAvatar source and variant). */
export type ProjectIcon = { color?: string; url?: string; override?: string }

export function ProjectAvatar(props: { name: string; size?: number; icon?: ProjectIcon; hidden?: boolean }) {
  const size = props.size ?? 16
  const src = props.icon?.override ?? (props.icon?.color ? undefined : props.icon?.url)
  const color = avatarColors.find((item) => item === props.icon?.color)
  return (
    <span data-component="project-avatar-v2" className="flex shrink-0" aria-hidden={props.hidden || undefined}>
      {src ? (
        // A plain image (not the Avatar primitive's) so it is in the DOM before it loads.
        <span className="ui-avatar ui-avatar--square" style={{ "--ui-avatar-size": `${size}px` } as CSSProperties}>
          <img src={src} alt="" draggable={false} data-slot="project-avatar-image" className="ui-avatar__image" />
        </span>
      ) : (
        <Avatar
          name={props.name}
          color={color ? avatarColor(color) : nameColor(props.name)}
          size={size}
          square
        />
      )}
    </span>
  )
}

/** The working indicator of a session (the Solid window's session-progress-indicator-v2). */
export function SessionProgress(props: { size?: number }) {
  const i18n = useI18n()
  return (
    <span data-component="session-progress-indicator-v2" className="flex shrink-0 items-center justify-center">
      <Spinner size={props.size ?? 14} label={i18n.t("common.loading")} />
    </span>
  )
}
