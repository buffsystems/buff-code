import { createEffect, on } from "solid-js"

/**
 * Зовёт `read` для каталога, как только TUI его знает, и снова — когда каталог сменился.
 * Своё расположение TUI узнаёт у сервера после подключения: чтение до этого ушло бы без
 * каталога и попало в чужой (#370).
 */
export function followDirectory(directory: () => string | undefined, read: (directory: string) => void): void {
  createEffect(
    on(directory, (current, previous) => {
      if (current && current !== previous) read(current)
    }),
  )
}
