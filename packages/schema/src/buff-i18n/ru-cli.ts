/** Русский каталог (#472): разовые команды buff в терминале — настройка при запуске, вход, подключение редактора. */
export const cli = {
  "no context selected": "контекст не выбран",
  "{head} · spaces: {spaces}": "{head} · пространства: {spaces}",
  "The company connector returned no models for the organization {org}.":
    "Коннектор компании не вернул моделей для организации {org}.",
  "Buff Code is not set up: run buff to sign in to Buff, or connect your own provider with buff auth login":
    "Buff Code не настроен: запустите buff, чтобы войти в Buff, или подключите свой провайдер командой buff auth login",
  "Loading Buff…": "Загружаю Buff…",
  "There is no Buff on the server": "Buff на сервере нет",
  "Buff is not set up yet": "Buff ещё не настроен",
  "Sign-in to Buff goes through your company connector": "Вход в Buff — через коннектор вашей компании",
  Cancelled: "Отменено",
  "Context: {context} · change it with /org and /project in buff": "Контекст: {context} · сменить — /org и /project в buff",
  "Signed in: {name}": "Вход выполнен: {name}",
  "Starting sign-in…": "Начинаю вход…",
  "Sign-in started": "Вход начат",
  "Waiting for confirmation in the cabinet…": "Ждём подтверждения в кабинете…",
  "Command failed": "Не удалось",
  "Run buff auth login in the terminal — sign in to Buff or connect your own provider":
    "Запустите buff auth login в терминале — вход в Buff или подключение своего провайдера",
  "Sign in to Buff Code": "Вход в Buff Code",
  // Вход, выход и смена учётной записи провайдера (`buff auth …`, #628).
  "Pass an integration ID or name when running without an interactive terminal":
    "Без интерактивного терминала укажите ID или имя интеграции",
  "Pass a credential ID or label when running without an interactive terminal":
    "Без интерактивного терминала укажите ID или метку учётных данных",
  "Pass --method when running without an interactive terminal": "Без интерактивного терминала укажите --method",
  "This login requires an interactive terminal to enter the authorization code":
    "Для этого входа нужен интерактивный терминал: в нём вводится код авторизации",
  "API key input requires an interactive terminal": "Для ввода API-ключа нужен интерактивный терминал",
  "Authentication form input requires an interactive terminal":
    "Для заполнения формы входа нужен интерактивный терминал",
  "{name} has no interactive login methods": "У {name} нет способов входа через терминал",
  "Discovering authentication provider…": "Ищу провайдера входа…",
  "Authentication provider discovered": "Провайдер входа найден",
  "Discovery failed": "Провайдер входа не найден",
  "No authentication integrations are available": "Нет интеграций, в которые можно войти",
  "Select integration": "Выберите интеграцию",
  connected: "подключено",
  "Select login method": "Выберите способ входа",
  "Enter your {name} API key": "Введите API-ключ {name}",
  "Saving credential…": "Сохраняю учётные данные…",
  "Paste the authorization code": "Вставьте код авторизации",
  "Completing authorization…": "Завершаю авторизацию…",
  "Authorization expired": "Время авторизации истекло",
  "Starting authentication command…": "Запускаю команду входа…",
  "Waiting for authentication command…": "Жду команду входа…",
  "Log out of an account": "Выход из учётной записи",
  "Removing credential…": "Удаляю учётные данные…",
  "Removed account from {name}": "Учётная запись {name} удалена",
  "Failed to remove credential": "Не удалось удалить учётные данные",
  "Switch account": "Смена учётной записи",
  "Switching account…": "Переключаю учётную запись…",
  "Switched account for {name}": "Учётная запись {name} переключена",
  "Failed to switch account": "Не удалось переключить учётную запись",
  "No stored credentials found": "Сохранённых учётных данных нет",
  "No stored credentials for {name}": "У {name} нет сохранённых учётных данных",
  "{name} is authenticated through {variables}; unset the environment variable to disconnect":
    "{name} подключён через {variables}; чтобы отключить, уберите переменную окружения",
  "Credential label “{label}” is ambiguous. Use an ID: {ids}":
    "Метка «{label}» встречается несколько раз. Укажите ID: {ids}",
  "Credential not found for {name}: {target}": "У {name} нет таких учётных данных: {target}",
  "Select the {name} account to log out of": "Выберите учётную запись {name}, из которой выйти",
  "Select the {name} account to switch to": "Выберите учётную запись {name}, на которую переключиться",
  "{label} (active)": "{label} (активна)",
  "Integration name “{target}” is ambiguous: {ids}": "Имя интеграции «{target}» подходит нескольким: {ids}",
  "Integration not found: {target}": "Интеграция не найдена: {target}",
  "Authentication method “{target}” is ambiguous": "Способ входа «{target}» подходит нескольким",
  "Authentication method not found: {target}": "Способ входа не найден: {target}",
  "Authentication method not found: {target}. Available: {available}":
    "Способ входа не найден: {target}. Есть: {available}",
  stored: "сохранено",
  environment: "окружение",
  "No authenticated integrations": "Подключённых интеграций нет",
  // Форма входа провайдера в терминале.
  "Expected --answer key=value": "Ожидается --answer ключ=значение",
  "Unknown form field: {key}": "Неизвестное поле формы: {key}",
  "Form field is not active: {key}": "Поле формы сейчас не используется: {key}",
  "External form field requires interactive confirmation: {key}":
    "Шаг вне терминала нужно подтвердить в интерактивном терминале: {key}",
  "Expected a JSON value for form field: {key}": "Для поля формы нужно значение JSON: {key}",
  "Continue after completing this step?": "Продолжить после этого шага?",
  "{step} is required": "{step}: обязательно",
  "External step": "Шаг вне терминала",
  "Type another value": "Ввести другое значение",
  "Enter value": "Введите значение",
  "Must be at least {min} characters": "Длина — не меньше {min} символов",
  "Must be at most {max} characters": "Длина — не больше {max} символов",
  "Invalid format": "Неверный формат",
  // Сопряжение (`buff pair`), подключение к серверу и настройки службы (`buff service …`).
  "Scan to pair": "Отсканируйте для сопряжения",
  "--server and --standalone cannot be combined": "--server и --standalone вместе не используются",
  "Warning: Server at {url} has version {server}; this client is {client}. Continuing anyway.":
    "Внимание: у сервера {url} версия {server}, у этого клиента — {client}. Продолжаю.",
  "Background server version does not match this client": "Версия фоновой службы не совпадает с версией клиента",
  "Server at {url} requires a password; set OPENCODE_PASSWORD":
    "Сервер {url} требует пароль: задайте OPENCODE_PASSWORD",
  "Server at {url} rejected the password": "Сервер {url} не принял пароль",
  "Could not reach server at {url}": "Не удалось связаться с сервером {url}",
  "Server at {url} did not provide a compatible V2 health response":
    "Сервер {url} не ответил совместимой проверкой состояния V2",
  "Unknown service config key: {key}": "Неизвестный параметр службы: {key}",
  "Usage: {command}": "Использование: {command}",
  "Port must be between 1 and 65535": "Порт — число от 1 до 65535",
  "CORS must be a comma-separated list of HTTP(S) origins without paths or trailing slashes":
    "CORS — список адресов HTTP(S) через запятую, без путей и косой черты в конце",
} as const
