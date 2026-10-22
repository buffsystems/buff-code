// Диагностика окна: подключаемся к странице по протоколу отладки и спрашиваем,
// что реально отрисовано. Нужен, когда снимок показывает заставку и непонятно почему.
const list = await fetch("http://127.0.0.1:9222/json").then((r) => r.json())
const page = list.find((t: any) => t.type === "page")
if (!page) throw new Error("страница не найдена")
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map<number, (v: any) => void>()
const send = (method: string, params: any = {}) =>
  new Promise<any>((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg.result); pending.delete(msg.id) }
  else if (msg.method === "Runtime.consoleAPICalled")
    console.log("консоль:", msg.params.args.map((a: any) => a.value ?? a.description ?? a.type).join(" "))
  else if (msg.method === "Log.entryAdded") console.log("журнал:", msg.params.entry.level, msg.params.entry.text)
}
await new Promise((r) => (ws.onopen = r))
await send("Runtime.enable"); await send("Log.enable")
const expr = (code: string) => send("Runtime.evaluate", { expression: code, returnByValue: true, awaitPromise: true })
console.log("заголовок:", (await expr("document.title")).result?.value)
console.log("оверлей заставки:", (await expr("!!document.querySelector('[data-component=startup-overlay]')")).result?.value)
console.log("текст страницы:", JSON.stringify(((await expr("document.body.innerText")).result?.value ?? "").slice(0, 600)))
console.log("ошибки в окне:", (await expr("window.__errors ? JSON.stringify(window.__errors) : 'нет'")).result?.value)
await new Promise((r) => setTimeout(r, 4000))
process.exit(0)
