/** Личный аккаунт Buff и его подписка (#966): вход, уровни моделей, расход. */
export const subscription = {
  active: "действует",
  "ended — read-only period, models are off": "закончилась — идёт срок чтения, модели выключены",
  "access stopped — contact support": "доступ остановлен — напишите в поддержку",
  "no subscription": "подписки нет",
  "5-hour limit": "Лимит на 5 часов",
  "Weekly limit": "Лимит на неделю",
  "{pct}% used": "израсходовано {pct} %",
  "{pct}%": "{pct} %",
  "resets any moment": "обновится с минуты на минуту",
  "resets in {m} min": "обновится через {m} мин",
  "resets in {h} h {m} min": "обновится через {h} ч {m} мин",
  "resets in {d} d {h} h": "обновится через {d} д {h} ч",
  "5 h": "5 ч",
  week: "неделя",
  "{window} is used up": "{window} исчерпан",
  "{window}: {used}": "{window}: {used}",
  // Вход (ядро).
  "Buff account": "Аккаунт Buff",
  "Buff subscription": "Подписка Buff",
  "In the browser on this computer": "В браузере на этом компьютере",
  "With a link and a code — over SSH or without a browser": "По ссылке и коду — по SSH или без браузера",
  "Allow the sign-in on the page that opens in the browser — Buff Code will continue by itself. No browser on this computer? Choose the sign-in with a link and a code.":
    "Разрешите вход на странице, которая откроется в браузере, — Buff Code продолжит сам. На этом компьютере нет браузера? Выберите вход по ссылке и коду.",
  "Open the link on any device, allow the sign-in and paste the code shown on the page here.":
    "Откройте ссылку на любом устройстве, разрешите вход и вставьте сюда код, который покажет страница.",
  "This code is from another sign-in attempt. Start the sign-in again and paste the new code.":
    "Этот код — от другой попытки входа. Начните вход заново и вставьте новый код.",
  "This is not the code from the sign-in page. Start the sign-in again and paste the whole line the page shows.":
    "Это не код со страницы входа. Начните вход заново и вставьте строку со страницы целиком.",
  "The sign-in was declined on the page.": "Вход отклонён на странице.",
  "The sign-in was declined": "Вход отклонён",
  "You can close this tab.": "Эту вкладку можно закрыть.",
  "Buff Code is signed in": "Вход в Buff Code выполнен",
  "You can close this tab and return to Buff Code.": "Эту вкладку можно закрыть и вернуться в Buff Code.",
  "Buff does not answer. Check the internet connection and try again.":
    "Buff не отвечает. Проверьте подключение к интернету и повторите.",
  "Buff refused the request.": "Buff отклонил запрос.",
  "Not signed in to the Buff account.": "Вход в аккаунт Buff не выполнен.",
  "The connection to Buff was lost. Check the internet connection.":
    "Связь с Buff оборвалась. Проверьте подключение к интернету.",
  "Could not get the subscription usage: {detail}": "Не удалось узнать расход подписки: {detail}",
  "The model request is too large (maximum {limit}). Shorten the context or remove some attachments.":
    "Запрос к модели слишком большой (максимум {limit}). Сократите контекст или уберите часть вложений.",
  // Расход в консоли и в окне.
  "active until {date}": "действует до {date}",
  "Subscription plan": "Тариф",
  "Subscription usage": "Расход подписки",
  "Buff: subscription usage": "Buff: расход подписки",
  "{warning} /usage — details.": "{warning} /usage — подробности.",
  "Could not get the subscription usage.": "Не удалось узнать расход подписки.",
  "Buff account {login}": "Аккаунт Buff {login}",
  Subscription: "Подписка",
  "not started yet": "расход ещё не начат",
  "No subscription information yet.": "Сведений о подписке пока нет.",
  "The limits are shared by the site, the phone and this computer. The subscription is managed on the Buff site.":
    "Лимиты общие для сайта, телефона и этого компьютера. Подпиской управляют на сайте Buff.",
  "Sign-in with a Buff account": "Вход аккаунтом Buff",
  "Sign in with a Buff account": "Войти аккаунтом Buff",
  "Models will appear when the account has an active subscription": "Модели появятся, когда у аккаунта будет действующая подписка",
  "The Buff account sign-in on this computer has ended: the device was revoked on the site or the sign-in was made anew. Sign in again.":
    "Вход в аккаунт Buff на этом компьютере завершён: устройство отозвано на сайте или вход выполнен заново. Войдите ещё раз.",
  // Первый вход (#966): аккаунт, компания или свой провайдер.
  "No model — your Buff account has no active subscription. Get one on the site or connect another provider.":
    "Нет модели — у аккаунта Buff нет действующей подписки. Оформите её на сайте или подключите другой провайдер.",
  "How do you sign in?": "Как вы входите?",
  "Your subscription — sign in on buff.systems": "Ваша подписка на buff.systems",
  "Company connector": "Коннектор компании",
  "Another provider": "Другой провайдер",
  "Your own key or your own server": "Свой ключ или свой сервер",
  "No company connector? Sign in with your own Buff account: its subscription is shared with the site and the phone.":
    "Нет коннектора компании? Войдите своим аккаунтом Buff: его подписка общая с сайтом и телефоном.",
  "Open the sign-in page": "Открыть страницу входа",
  "Waiting for you to allow the sign-in on the page…": "Ждём, когда вы разрешите вход на странице…",
  "The model could not answer this time. Repeat the request.": "Модель не смогла ответить. Повторите запрос.",
  "No connection to Buff. Check the internet connection and try again.":
    "Нет связи с Buff. Проверьте подключение к интернету и повторите.",
} as const
