import { Show, type ParentProps } from "solid-js"
import { ServerProvider } from "@/runtime/server/current"
import { useServers } from "@/runtime/server/registry"

/**
 * Подключение к службе для наших экранов, которые рисуются вне маршрутов сессии: знакомство
 * (#457) открывается над любым экраном, страница автоматизаций (#447) — свой маршрут. Служба
 * — первая из известных, как у настроек.
 */
export function ServerScope(props: ParentProps) {
  const servers = useServers()
  return (
    <Show when={servers.list[0]} keyed>
      {(conn) => <ServerProvider conn={conn}>{props.children}</ServerProvider>}
    </Show>
  )
}
