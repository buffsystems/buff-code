import { createContext, use, type ReactNode } from "react"
import type { Platform } from "./platform"

const PlatformContext = createContext<Platform | undefined>(undefined)

export function PlatformProvider(props: { value: Platform; children?: ReactNode }) {
  return <PlatformContext value={props.value}>{props.children}</PlatformContext>
}

export function usePlatform() {
  const platform = use(PlatformContext)
  if (!platform) throw new Error("usePlatform must be used inside PlatformProvider")
  return platform
}

/** The platform when there is one (components also mounted alone in tests). */
export function useOptionalPlatform() {
  return use(PlatformContext)
}
