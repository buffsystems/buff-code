import { onCleanup } from "solid-js"
import { useThemes } from "../context/theme"
import { useToast } from "../ui/toast"
import { t } from "../feature-plugins/buff/locale"

export function ThemeErrorToast() {
  const themes = useThemes()
  const toast = useToast()

  onCleanup(
    themes.onError(({ name, error }) =>
      toast.show({
        variant: "error",
        title: t("Failed to load theme: {name}", { name }),
        message: error.message,
      }),
    ),
  )

  return null
}
