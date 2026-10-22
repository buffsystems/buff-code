// Failed event-driven reads on screen (#584), as the Solid runtime's data onError: a «Request
// failed» toast with the server's words; the data layer keeps going and the next event retries.

import { formatServerError } from "@opencode/app/react-reuse/server-errors"
import { useEffect } from "react"
import { useI18n } from "../../i18n/provider"
import { useCore } from "../../react/core"
import { showToast } from "./toast"

export function useReadFailureToasts() {
  const core = useCore()
  const i18n = useI18n()
  useEffect(
    () =>
      core.onReadFailure((error) =>
        showToast({
          variant: "error",
          title: i18n.t("common.requestFailed"),
          description: formatServerError(error, i18n.t),
        }),
      ),
    [core, i18n],
  )
}
