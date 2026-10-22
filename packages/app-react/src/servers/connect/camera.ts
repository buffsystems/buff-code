// Whether this page can scan a pairing QR code (#584), ported from the Solid window's camera.ts: a
// secure web page with a camera the person did not deny.

import { useQuery } from "@tanstack/react-query"
import { usePlatform } from "../../platform/context"

async function cameraAvailable() {
  if (!navigator.mediaDevices?.enumerateDevices) return false
  const denied = await navigator.permissions?.query({ name: "camera" as PermissionName }).then(
    (permission) => permission.state === "denied",
    () => false,
  )
  if (denied) return false
  return navigator.mediaDevices.enumerateDevices().then(
    (devices) => devices.some((device) => device.kind === "videoinput"),
    () => false,
  )
}

export function useCameraAvailable(wanted: boolean) {
  const platform = usePlatform()
  const supported =
    wanted && platform.platform === "web" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  const query = useQuery({ queryKey: ["pairing-camera"], queryFn: cameraAvailable, enabled: supported, retry: false })
  return { available: supported && !!query.data, loading: supported && query.isPending }
}
