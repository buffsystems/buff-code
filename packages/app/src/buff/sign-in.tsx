import type { JSX } from "solid-js"
import type { useDialog } from "@opencode/ui/context/dialog"

/**
 * Вход в Buff — окно подключения, сразу на Buff: адрес коннектора, код, ожидание (#401).
 * Одно место на все точки входа: чип контекста и «выбор модели» до входа. В Buff Code
 * модели только организации, поэтому до входа выбирать нечего — показывать каталог
 * чужих облаков на этом месте нельзя (#377).
 */
export function openBuffSignIn(
  dialog: ReturnType<typeof useDialog>,
  directory: string,
  onClose?: () => void,
  /** Где служба ещё не подключена (знакомство, #457) — окно входа оборачивается в подключение. */
  scope: (content: () => JSX.Element) => JSX.Element = (content) => content(),
): void {
  void import("@/providers/connect/dialog").then(({ DialogConnectProvider, useProviderConnectController }) => {
    dialog.show(
      () =>
        scope(() => {
          const controller = useProviderConnectController()
          controller.select("buff")
          return <DialogConnectProvider directory={directory} controller={controller} />
        }),
      onClose,
    )
  })
}
