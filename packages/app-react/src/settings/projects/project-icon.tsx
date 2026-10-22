// A project's icon in settings (#584): its own image when one is set, else its initial on its
// colour — the Solid window's ProjectIcon. The colours are @buff/ui's project palette; only the
// older stored keys are the app's own.

import { Avatar, avatarColor, avatarColors, nameColor, type AvatarColor } from "@buff/ui/react"

/** The colour a stored key stands for; older keys map to their successors. */
export function projectColor(key: string | undefined): AvatarColor | undefined {
  if (key === "mint") return "cyan"
  if (key === "lime") return "green"
  return avatarColors.find((color) => color === key)
}

export function ProjectIcon(props: { name: string; color?: string; override?: string; size?: number }) {
  const color = projectColor(props.color)
  return (
    <span data-component="project-avatar-v2" className="flex shrink-0">
      <Avatar
        src={props.override || undefined}
        name={props.name}
        color={color ? avatarColor(color) : nameColor(props.name)}
        size={props.size ?? 16}
        square
      />
    </span>
  )
}

export function ColorSwatch(props: { color: AvatarColor; size?: number }) {
  return (
    <span
      aria-hidden
      className="block rounded-md"
      style={{ width: props.size ?? 20, height: props.size ?? 20, background: avatarColor(props.color) }}
    />
  )
}
