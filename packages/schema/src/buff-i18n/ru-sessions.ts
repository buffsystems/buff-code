/** Русский каталог (#472): колонка сессий, группы, состояния, страницы Buff. */
export const sessions = {
  // страницы Buff
  Automations: "Автоматизации",
  Workflows: "Сценарии",
  // разделы списка
  Today: "Сегодня",
  Yesterday: "Вчера",
  Earlier: "Раньше",
  Pinned: "Закреплённые",
  // Recents (#922)
  "Active chats": "Активные",
  Recent: "Недавние",
  // состояние сессии
  "Waiting for permission": "Ждёт разрешения",
  "Waiting for an answer": "Ждёт ответа",
  Running: "Выполняется",
  Error: "Ошибка",
  Unread: "Не прочитано",
  // отметки
  "Name the group.": "Назовите группу.",
  "No such group.": "Такой группы нет.",
  // цвета групп
  Blue: "Синий",
  Green: "Зелёный",
  Orange: "Оранжевый",
  Red: "Красный",
  Purple: "Фиолетовый",
  Gray: "Серый",
  // колонка
  Chats: "Чаты",
  "Could not rename.": "Не удалось переименовать.",
  "Could not save.": "Не удалось сохранить.",
  "{field}: the field cannot be empty.": "{field}: поле не может быть пустым.",
  Color: "Цвет",
  Cancel: "Отмена",
  Save: "Сохранить",
  "New group": "Новая группа",
  Name: "Название",
  "Restore from archive": "Вернуть из архива",
  Unpin: "Открепить",
  Pin: "Закрепить",
  "Rename chat": "Переименовать чат",
  Rename: "Переименовать",
  "To group «{name}»": "В группу «{name}»",
  "To a new group…": "В новую группу…",
  "Remove from group": "Убрать из группы",
  Archive: "В архив",
  Group: "Группа",
  "Edit group": "Изменить группу",
  "Delete group — chats stay": "Удалить группу — чаты останутся",
  "All chats": "Все чаты",
  "Search by title": "Поиск по названию",
  "Empty — add a chat from its menu.": "Пусто — добавьте чат из его меню.",
  "Nothing found by title.": "По названию ничего не найдено.",
  "No chats yet.": "Чатов пока нет.",
  "In conversations": "В переписке",
  "Archive · {count}": "Архив · {count}",
  // #765: раздел режима «Настройка».
  "Self-setup": "Самонастройка",
  "New self-setup": "Новая самонастройка",
  "Self-setup: a new chat where the agent connects itself to what you need":
    "Самонастройка: новый чат, где агент сам подключается к тому, что вам нужно",
  "Self-setup: the agent connects itself to a service, an account or a folder you need.":
    "Самонастройка: агент сам подключается к нужному вам сервису, аккаунту или папке.",
  "Nothing connected yet — press + and ask to connect something.":
    "Пока ничего не подключено — нажмите + и попросите что-нибудь подключить.",
  // #972 (PR-03): the project's home on the window's Home.
  "New chat in the project": "Новый чат в проекте",
  "Instructions and memory": "Инструкции и память",
  "Project settings": "Настройки проекта",
  "Open the folder": "Открыть папку",
  "The file did not open": "Файл не открылся",
  "The folder did not open": "Папка не открылась",
} as const
