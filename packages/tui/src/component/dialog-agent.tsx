import { createMemo } from "solid-js"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { t } from "../feature-plugins/buff/locale"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.id,
        title: item.id,
        // Buff (#470): описания встроенных агентов — через каталог.
        description: item.description ? t(item.description) : undefined,
      }
    }),
  )

  return (
    <DialogSelect
      title={t("Select agent")}
      current={local.agent.current()?.id}
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
