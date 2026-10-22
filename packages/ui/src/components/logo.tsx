import { For, type ComponentProps } from "solid-js"

// Buff (#596): the brand mark is the brain of the app icon (lucide `brain`), not the upstream "O".
const brain = [
  "M12 18V5",
  "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4",
  "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5",
  "M17.997 5.125a4 4 0 0 1 2.526 5.77",
  "M18 18a4 4 0 0 0 2-7.464",
  "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517",
  "M6 18a4 4 0 0 1-2-7.464",
  "M6.003 5.125a4 4 0 0 0-2.526 5.77",
]

const Brain = (props: { component: string; ref?: ComponentProps<"svg">["ref"]; class?: string }) => {
  return (
    <svg
      ref={props.ref}
      data-component={props.component}
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--icon-strong-base)"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <For each={brain}>{(d) => <path d={d} />}</For>
    </svg>
  )
}

export const Mark = (props: { class?: string }) => <Brain component="logo-mark" class={props.class} />

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <Brain component="logo-splash" ref={props.ref} class={props.class} />
)

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 246 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M6 18H18V30H6Z" fill="var(--icon-weak-base)" />
        <path d="M6 18V30H18V18H6ZM0 0H6V6H24V36H0Z" fill="var(--icon-base)" />
        <path d="M36 6H48V30H36Z" fill="var(--icon-weak-base)" />
        <path d="M30 6H36V30H48V6H54V36H30Z" fill="var(--icon-base)" />
        <path d="M66 0H84V6H72V36H66ZM60 12H78V18H60Z" fill="var(--icon-base)" />
        <path d="M96 0H114V6H102V36H96ZM90 12H108V18H90Z" fill="var(--icon-base)" />
        <g transform="translate(12 0)">
        <path d="M144 30H126V18H144V30Z" fill="var(--icon-weak-base)" />
        <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="var(--icon-strong-base)" />
        <path d="M168 30H156V18H168V30Z" fill="var(--icon-weak-base)" />
        <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="var(--icon-strong-base)" />
        <path d="M198 30H186V18H198V30Z" fill="var(--icon-weak-base)" />
        <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="var(--icon-strong-base)" />
        <path d="M234 24V30H216V24H234Z" fill="var(--icon-weak-base)" />
        <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="var(--icon-strong-base)" />
        </g>
      </g>
    </svg>
  )
}
