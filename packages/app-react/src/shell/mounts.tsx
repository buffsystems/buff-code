// Window-wide pieces other features contribute (#584): a folder adds `src/<folder>/app-mount.tsx`
// whose default export is one AppMount or an array — the first-run introduction, automation
// notices, the language sync — and the shell renders them once, beside the routed screen, each in
// its own error boundary and Suspense. No edit to app.tsx or the shell.

import { Component, Suspense, type ComponentType, type ReactNode } from "react"

export type AppMount = { id: string; component: ComponentType }

const found = (): Record<string, { default: AppMount | AppMount[] }> => {
  try {
    return import.meta.glob<{ default: AppMount | AppMount[] }>("../*/app-mount.tsx", { eager: true })
  } catch {
    return {}
  }
}

export const appMounts: AppMount[] = Object.values(found())
  .flatMap((module) => (Array.isArray(module.default) ? module.default : [module.default]))
  .toSorted((a, b) => a.id.localeCompare(b.id))

export function AppMounts() {
  return (
    <>
      {appMounts.map((mount) => (
        <MountBoundary key={mount.id}>
          <Suspense>
            <mount.component />
          </Suspense>
        </MountBoundary>
      ))}
    </>
  )
}

// A failing contribution disappears instead of taking the window down.
class MountBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
