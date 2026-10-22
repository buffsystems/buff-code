import { createContext, use, useEffect, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react"
import { useStore } from "../react/use-store"
import type { History } from "./history"
import { delegateLinks } from "./links"
import { matchRoute } from "./routes"

const RouterContext = createContext<History | undefined>(undefined)

export function RouterProvider(props: { history: History; children?: ReactNode }) {
  useEffect(() => delegateLinks(props.history), [props.history])
  return <RouterContext value={props.history}>{props.children}</RouterContext>
}

export function useHistory() {
  const history = use(RouterContext)
  if (!history) throw new Error("Router hooks must be used inside RouterProvider")
  return history
}

export function useLocation() {
  return useStore(useHistory().location, (location) => location)
}

export function useRoute() {
  const pathname = useStore(useHistory().location, (location) => location.pathname)
  return matchRoute(pathname)
}

export function useNavigate() {
  return useHistory().navigate
}

/** An anchor that navigates in-window on a plain click, keeping a real href for the rest. */
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = useNavigate()
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(props.href)
  }
  return <a {...props} onClick={onClick} />
}
