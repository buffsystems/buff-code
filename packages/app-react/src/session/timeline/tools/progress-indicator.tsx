import frames from "@opencode/session-ui/progress-indicator-v2-1x.png"
import { useId } from "react"

const dots = Array.from({ length: 25 }, (_, index) => {
  const x = 1.5 + (index % 5) * 3
  const y = 1.5 + Math.floor(index / 5) * 3
  return `M${x} ${y}h2v2h-2z`
}).join("")

/** The running mark of a subagent's card (#584): the Solid window's animated 5×5 dot grid. */
export function ProgressIndicator() {
  const id = useId()
  const filter = `progress-filter-${id}`
  const clip = `progress-clip-${id}`
  return (
    <svg
      data-component="session-progress-indicator-v2"
      className="progress-indicator"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <filter id={filter} filterUnits="userSpaceOnUse" x={0} y={0} width={16} height={16}>
          <feFlood floodColor="currentColor" result="color" />
          <feComposite in="color" in2="SourceAlpha" operator="in" />
        </filter>
        <clipPath id={clip}>
          <path d={dots} />
        </clipPath>
      </defs>
      <image
        data-frame-content
        href={frames}
        x={0}
        y={0}
        width={16}
        height={16}
        filter={`url(#${filter})`}
        clipPath={`url(#${clip})`}
      />
      <rect data-reduced-motion x={7.5} y={7.5} width={2} height={2} />
    </svg>
  )
}
