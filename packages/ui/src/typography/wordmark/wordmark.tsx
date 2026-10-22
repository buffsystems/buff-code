import { createUniqueId, type ComponentProps } from "solid-js"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 756.923 129"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M18.4615 55.3846V92.3077H55.3846V55.3846H18.4615ZM0 0H18.4615V18.4615H73.8462V110.769H0Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M92.3077 18.4615H110.769V92.3077H147.692V18.4615H166.154V110.769H92.3077Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M203.077 0H258.462V18.4615H221.538V110.769H203.077ZM184.615 36.9231H240V55.3846H184.615Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M295.385 0H350.769V18.4615H313.846V110.769H295.385ZM276.923 36.9231H332.308V55.3846H276.923Z"
            />
            <g transform="translate(36.9231 0)">
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M442.846 36.4286H387.462V91.7143H442.846V110.143H369V18H442.846V36.4286Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M517.385 36.4286H480.462V91.7143H517.385V36.4286ZM535.846 110.143H462V18H535.846V110.143Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M609.385 36.8571H572.462V92.1429H609.385V36.8571ZM627.846 110.571H554V18.4286H609.385V0H627.846V110.571Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M664.462 36.4286V54.8571H701.385V36.4286H664.462ZM719.846 73.2857H664.462V91.7143H719.846V110.143H646V18H719.846V73.2857Z"
            />
            </g>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="756.923" height="129">
          <rect width="756.923" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="378.462" y1="68" x2="378.462" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
