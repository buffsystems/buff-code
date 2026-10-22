import { Content, Portal, Root, Trigger } from "@kobalte/core/tooltip"
import { createEffect, Match, onCleanup, splitProps, Switch, untrack, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import "./tooltip.css"

export interface TooltipProps extends ComponentProps<typeof Root> {
  value: JSX.Element
  appearance?: "standard" | "compact" | "large"
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
  triggerTabIndex?: number
}

export function Tooltip(props: TooltipProps) {
  let ref: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
  })
  const [local, others] = splitProps(props, [
    "children",
    "appearance",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "triggerTabIndex",
    "ignoreSafeArea",
    "value",
  ])

  const close = () => setState("open", false)
  const controlled = () => local.forceOpen !== undefined

  const inside = () => {
    const active = document.activeElement
    if (!ref || !active) return false
    return ref.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand || !state.block) return
    if (ref?.matches(":hover")) return
    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!ref?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)
    if (expand) {
      setState("block", true)
      close()
      return
    }
    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const leave = () => {
    if (!inside()) close()
    drop()
  }

  createEffect(() => {
    if (!ref) return
    untrack(sync)
    const obs = new MutationObserver(sync)
    obs.observe(ref, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => obs.disconnect())
  })

  let justClickedTrigger = false
  // Buff (#584): Kobalte hides a tooltip when anything around its trigger scrolls, for a trigger
  // carried away by the scroll. A trigger in a sticky row (the session title row in the transcript's
  // scroller) does not move: the transcript settling at its end or following a stream closed its
  // tooltip under the pointer. A close is ignored while the trigger is still under the pointer where
  // it opened — unless Escape asked for it.
  const placed = { rect: undefined as DOMRect | undefined, escape: -Infinity }
  createEffect(() => {
    if (!state.open || !ref) return
    placed.rect = ref.getBoundingClientRect()
    // Capture on window runs before Kobalte's Escape handling on the document.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") placed.escape = performance.now()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
  })
  const stayedPut = () => {
    if (!ref || !placed.rect || performance.now() - placed.escape < 50 || !ref.matches(":hover")) return false
    const rect = ref.getBoundingClientRect()
    return Math.abs(rect.top - placed.rect.top) < 1 && Math.abs(rect.left - placed.rect.left) < 1
  }

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <Root
          gutter={4}
          openDelay={400}
          skipDelayDuration={300}
          {...others}
          closeDelay={0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={controlled() ? local.forceOpen : state.open}
          onOpenChange={(open) => {
            if (controlled()) return
            if (state.block && open) return
            if (justClickedTrigger) {
              justClickedTrigger = false
              return
            }
            if (!open && stayedPut()) return
            setState("open", open)
          }}
        >
          <Trigger
            ref={ref}
            as="div"
            tabIndex={local.triggerTabIndex}
            data-component="tooltip-v2-trigger"
            class={local.class}
            onPointerDownCapture={arm}
            onKeyDownCapture={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return
              arm()
            }}
            onPointerLeave={leave}
            onFocusOut={() => requestAnimationFrame(() => drop())}
          >
            {local.children}
          </Trigger>
          <Portal>
            <Content
              ref={(el) => {
                const theme = ref?.closest("[data-theme]")?.getAttribute("data-theme")
                if (theme) el.setAttribute("data-theme", theme)
              }}
              data-component="tooltip-v2"
              data-appearance={local.appearance ?? "compact"}
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerDownOutside={(e) => {
                if (ref === e.target || (e.target instanceof Node && ref?.contains(e.target))) {
                  justClickedTrigger = true
                }
                e.preventDefault()
              }}
            >
              {local.value}
            </Content>
          </Portal>
        </Root>
      </Match>
    </Switch>
  )
}
