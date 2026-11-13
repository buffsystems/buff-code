// Что уже ушло телефону (#908): сессия меняется часто (дельты текста модели), и телефон, смотрящий её,
// получал на каждое изменение последние сообщения целиком — за часы работы это выбирало суточный
// лимит пары на шлюзе. Теперь — только сообщения, изменившиеся с прошлой отправки этому телефону;
// телефон сливает их со своими по id.

type Message = { id?: unknown }

export function sentMessages() {
  // `${device}|${session}` → id сообщения → то, что ушло (как текст: сравнение без глубокого обхода).
  const sent = new Map<string, Map<unknown, string>>()
  return {
    fresh(device: string, session: string, messages: unknown[]): unknown[] {
      const key = `${device}|${session}`
      const was = sent.get(key) ?? new Map<unknown, string>()
      sent.set(key, was)
      return messages.filter((m) => {
        const id = (m as Message | null)?.id
        const text = JSON.stringify(m)
        if (was.get(id) === text) return false
        was.set(id, text)
        return true
      })
    },
    /** Телефон снова открыл сессию или ушёл из неё: в следующий раз — всё заново. */
    forget(device: string, session: string): void {
      sent.delete(`${device}|${session}`)
    },
  }
}
