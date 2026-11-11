// Buff (#816, эпик #769): публичные ссылки машины — логика без ввода-вывода. Запись живёт здесь
// (store.ts), на шлюзе лишь индекс «id → машина»: ссылка объявляется там при создании и отзывается
// при удалении — своём или источника. Зритель шлюза спрашивает содержимое командами `share.*`, и
// каждая проходит правила ссылки: включена ли, не истёк ли срок, верен ли пароль. Всё, что
// отвечает, строится из сообщений сессии в момент запроса — у нас ничего не оседает.
import {
  isShareId,
  newShareId,
  parseShareFileArgs,
  parseShareViewArgs,
  ProtocolError,
  RefusalError,
  SHARE_FILE_CHUNK,
  type ShareFileChunk,
  SHARE_FILE,
  SHARE_VIEW,
  type PeerLog,
  type Reply,
  type ShareRefusal,
} from "@buff/mobile-protocol"
import { BuffLocale } from "../locale.js"
import { buildDocument, fileChunk, sentFile, type StoredMessage } from "./document.js"
import { hashPassword, verifyPassword, type ShareRecord, type ShareStore } from "./store.js"

/** Сколько байты переданного файла ждут следующей части (#897). */
const HELD_MS = 60_000

export interface LinkPorts {
  store: ShareStore
  /** Шлюз: buff.systems или стенд — хост ссылок. */
  gatewayHost: string
  /** Команда шлюзу в имени машины (связь поднимается, если её нет): объявить / отозвать ссылку. */
  publish(id: string, expiresAt: number | null): Promise<boolean>
  revoke(id: string): Promise<boolean>
  /** Сессия, как её знает сервер; null — её больше нет. */
  /** `parent` — сессия, чей субагент её вёл (#893). */
  session(id: string): Promise<{ title: string; active?: boolean; parent?: string } | null>
  /** Все сообщения сессии по порядку. */
  messages(session: string): Promise<StoredMessage[]>
  /** Байты файла из каталога сессии (#892: файл, переданный агентом); null — его нет или он вне каталога. */
  read?(session: string, file: string): Promise<Uint8Array | null>
  /** Эпоха, мс. */
  now(): number
  newId?: () => string
  log?: PeerLog
}

/** Ссылка, как её показывают окно, консоль и телефон. */
export interface ShareView {
  id: string
  link: string
  session: string
  kind: "session" | "messages"
  messages: number
  title: string
  hasPass: boolean
  expiresAt: number | null
  tools: boolean
  live: boolean
  enabled: boolean
  created: number
  /** Шлюз знает о ссылке; false — объявление ещё не дошло (нет связи), страница пока её не найдёт. */
  published: boolean
  /** Название сессии-источника сейчас; null — её уже нет. */
  sessionTitle: string | null
}

export interface CreateInput {
  session: string
  messages?: readonly string[]
  title: string
  pass?: string
  expiresAt?: number | null
  tools?: boolean
  live?: boolean
}

export interface UpdateInput {
  title?: string
  /** Новый пароль; пустая строка или null — снять. */
  pass?: string | null
  expiresAt?: number | null
  tools?: boolean
  live?: boolean
  enabled?: boolean
}

const TITLE_MAX = 200
const refused = (why: ShareRefusal): Reply => ({ ok: true, refused: why })
const silent: PeerLog = { info() {}, warn() {}, error() {} }

export class ShareLinks {
  readonly p: LinkPorts
  private readonly log: PeerLog

  constructor(ports: LinkPorts) {
    this.p = ports
    this.log = ports.log ?? silent
  }

  link(id: string): string {
    return `https://${this.p.gatewayHost}/share/${id}`
  }

  /** Действующие ссылки (снятые и ждущие отзыва — нет), с названием сессии-источника. */
  async list(): Promise<ShareView[]> {
    const records = (await this.p.store.list()).filter((r) => !r.gone)
    const titles = new Map<string, string | null>()
    for (const id of new Set(records.map((r) => r.session))) titles.set(id, (await this.p.session(id))?.title ?? null)
    return records.map((r) => this.view(r, titles.get(r.session) ?? null))
  }

  /** Есть ли что объявлять или отзывать — тогда связь со шлюзом нужна и без телефонов. */
  async pending(): Promise<boolean> {
    return (await this.p.store.list()).some((r) => r.gone || !r.published)
  }

  async hasActive(): Promise<boolean> {
    return (await this.p.store.list()).some((r) => !r.gone)
  }

  async create(input: CreateInput): Promise<ShareView> {
    const title = (input.title ?? "").trim().slice(0, TITLE_MAX)
    if (!title) throw new RefusalError(BuffLocale.t("The title is required"))
    if (!(await this.p.session(input.session))) throw new RefusalError(BuffLocale.t("The session is not found"))
    const messages = [...new Set((input.messages ?? []).filter((m) => typeof m === "string" && m))]
    const record: ShareRecord = {
      id: (this.p.newId ?? newShareId)(),
      session: input.session,
      messages,
      title,
      pass: input.pass ? hashPassword(input.pass) : null,
      expiresAt: expiry(input.expiresAt),
      tools: input.tools === true,
      live: input.live === true,
      enabled: true,
      created: this.p.now(),
      published: false,
    }
    // Без шлюза ссылка никому не откроется — лучше сказать это сразу, чем выдать мёртвый адрес.
    if (!(await this.p.publish(record.id, record.expiresAt))) throw this.noGateway()
    record.published = true
    await this.p.store.save(record)
    return this.view(record, (await this.p.session(record.session))?.title ?? null)
  }

  async update(id: string, patch: UpdateInput): Promise<ShareView> {
    const record = await this.live(id)
    const next: ShareRecord = { ...record }
    if (patch.title !== undefined) {
      const title = patch.title.trim().slice(0, TITLE_MAX)
      if (!title) throw new RefusalError(BuffLocale.t("The title is required"))
      next.title = title
    }
    if (patch.pass !== undefined) next.pass = patch.pass ? hashPassword(patch.pass) : null
    if (patch.tools !== undefined) next.tools = patch.tools
    if (patch.live !== undefined) next.live = patch.live
    if (patch.enabled !== undefined) next.enabled = patch.enabled
    if (patch.expiresAt !== undefined) {
      next.expiresAt = expiry(patch.expiresAt)
      // Новый срок — шлюзу тоже: он чистит индекс по нему. Не дошло — объявим при следующей связи.
      next.published = await this.p.publish(next.id, next.expiresAt)
    }
    await this.p.store.save(next)
    return this.view(next, (await this.p.session(next.session))?.title ?? null)
  }

  /** Ссылка снята человеком: отозвать на шлюзе; не вышло — запись ждёт отзыва и исчезнет потом. */
  async remove(id: string): Promise<void> {
    const record = await this.live(id)
    await this.end(record)
  }

  /** Источник удалён (сессия): все его ссылки кончаются — страница скажет «удалён владельцем». */
  async sourceDeleted(session: string): Promise<number> {
    const records = (await this.p.store.list()).filter((r) => r.session === session && !r.gone)
    for (const r of records) await this.end(r)
    return records.length
  }

  /** Объявить, что не объявлено, отозвать, что снято — при каждой связи со шлюзом. */
  async sync(): Promise<void> {
    for (const r of await this.p.store.list()) {
      if (r.gone) {
        if (await this.p.revoke(r.id)) await this.p.store.remove(r.id)
      } else if (!r.published && (await this.p.publish(r.id, r.expiresAt))) {
        await this.p.store.save({ ...r, published: true })
      }
    }
  }

  /** Команда зрителя шлюза: только `share.view` и `share.file`, каждая — через правила ссылки. */
  async serve(op: string, args: unknown): Promise<Reply> {
    if (op === SHARE_VIEW) {
      const a = parsed(parseShareViewArgs, args)
      const opened = await this.open(a.id, a.pass)
      if ("refused" in opened) return refused(opened.refused)
      if (a.sub) return this.subagent(opened.record, a.sub, { after: a.after, limit: a.limit, tail: a.tail })
      const messages = await this.p.messages(opened.record.session)
      return {
        ok: true,
        document: buildDocument(
          opened.record,
          messages,
          { after: a.after, limit: a.limit, tail: a.tail },
          opened.title,
          opened.active,
        ),
      }
    }
    if (op === SHARE_FILE) {
      const a = parsed(parseShareFileArgs, args)
      const opened = await this.open(a.id, a.pass)
      if ("refused" in opened) return refused(opened.refused)
      const held = this.heldFile(a.id, a.file)
      if (held) return { ok: true, chunk: held(a.from) }
      const messages = await this.p.messages(opened.record.session)
      const chunk =
        fileChunk(opened.record, messages, a.file, a.from) ??
        (await this.sentChunk(opened.record, messages, a.file, a.from))
      if (!chunk) throw new RefusalError(BuffLocale.t("No such file"))
      return { ok: true, chunk }
    }
    throw new RefusalError(`not available to the share viewer: ${op}`)
  }

  /**
   * Переданный файл, который сейчас качают (#897): его байты держим между частями — иначе каждая
   * часть заново читала всю сессию и весь файл, и 8 МБ шли минуту. Один файл, недолго; пароль
   * ссылки проверен до обращения сюда.
   */
  private held?: { key: string; until: number; chunk: (from: number) => ShareFileChunk }

  private heldFile(id: string, file: string): ((from: number) => ShareFileChunk) | null {
    const held = this.held
    if (!held || held.key !== `${id}\n${file}` || held.until <= this.p.now()) return null
    held.until = this.p.now() + HELD_MS
    return held.chunk
  }

  /** Часть файла, который агент передал человеку (#892): с диска, из каталога сессии. */
  private async sentChunk(
    record: ShareRecord,
    messages: StoredMessage[],
    file: string,
    from: number,
  ): Promise<ShareFileChunk | null> {
    const sent = sentFile(record, messages, file)
    const bytes = sent && this.p.read ? await this.p.read(record.session, sent.path) : null
    if (!sent || !bytes) return null
    const info = { id: file, name: sent.name, mime: sent.mime, size: bytes.length }
    const chunk = (at: number): ShareFileChunk => {
      const part = bytes.subarray(at, at + SHARE_FILE_CHUNK)
      return {
        file: info,
        data: Buffer.from(part).toString("base64"),
        from: at,
        next: at + part.length < bytes.length ? at + part.length : null,
      }
    }
    // A file of one chunk is done with this answer: nothing to hold.
    if (bytes.length > SHARE_FILE_CHUNK)
      this.held = { key: `${record.id}\n${file}`, until: this.p.now() + HELD_MS, chunk }
    return chunk(from)
  }

  /**
   * Сессия субагента по ссылке на его родителя (#893): читается только у ссылки на всю сессию,
   * показывающей инструменты, и только потомок этой сессии — иначе такой страницы нет.
   */
  private async subagent(
    record: ShareRecord,
    sub: string,
    page: { after?: string; limit: number; tail?: boolean },
  ): Promise<Reply> {
    if (record.messages.length || !record.tools) return refused("missing")
    const child = await this.p.session(sub)
    if (!child || !(await this.descends(child.parent, record.session))) return refused("missing")
    const whole = { ...record, messages: [], title: "" }
    const document = buildDocument(whole, await this.p.messages(sub), page, child.title, child.active ?? false)
    // The answer names whose session it is: behind an old gateway the viewer would get the parent's.
    return { ok: true, document: { ...document, sub } }
  }

  /** Ведёт ли цепочка родителей к сессии ссылки; глубина ограничена — цикла в данных не ждём, но и не верим. */
  private async descends(parent: string | undefined, root: string): Promise<boolean> {
    for (let id = parent, depth = 0; id && depth < 8; depth++) {
      if (id === root) return true
      id = (await this.p.session(id))?.parent
    }
    return false
  }

  /** Правила ссылки по порядку: есть ли, снята ли, включена ли, не истекла ли, пароль, жив ли источник. */
  private async open(
    id: string,
    pass?: string,
  ): Promise<{ record: ShareRecord; title: string; active: boolean } | { refused: ShareRefusal }> {
    const record = isShareId(id) ? await this.p.store.get(id) : null
    if (!record) return { refused: "missing" }
    if (record.gone) return { refused: "deleted" }
    if (!record.enabled) return { refused: "disabled" }
    if (record.expiresAt !== null && record.expiresAt <= this.p.now()) return { refused: "expired" }
    if (record.pass && (!pass || !verifyPassword(record.pass, pass))) return { refused: "password" }
    const session = await this.p.session(record.session)
    if (!session) {
      // Источник исчез, а событие удаления нас не застало: кончаем ссылку сейчас.
      await this.end(record)
      return { refused: "deleted" }
    }
    return { record, title: session.title, active: session.active === true }
  }

  private async end(record: ShareRecord): Promise<void> {
    if (await this.p.revoke(record.id)) return this.p.store.remove(record.id)
    this.log.warn("share: the gateway did not take the revocation, kept for later", { id: record.id })
    await this.p.store.save({ ...record, gone: true })
  }

  private async live(id: string): Promise<ShareRecord> {
    const record = await this.p.store.get(id)
    if (!record || record.gone) throw new RefusalError(BuffLocale.t("The link is not found"))
    return record
  }

  private noGateway(): RefusalError {
    return new RefusalError(
      BuffLocale.t(
        "No link to the gateway {gateway}: the link cannot be published — check the internet and try again.",
        {
          gateway: this.p.gatewayHost,
        },
      ),
    )
  }

  private view(r: ShareRecord, sessionTitle: string | null): ShareView {
    return {
      id: r.id,
      link: this.link(r.id),
      session: r.session,
      kind: r.messages.length ? "messages" : "session",
      messages: r.messages.length,
      title: r.title,
      hasPass: r.pass !== null,
      expiresAt: r.expiresAt,
      tools: r.tools,
      live: r.live,
      enabled: r.enabled,
      created: r.created,
      published: r.published,
      sessionTitle,
    }
  }
}

function expiry(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RefusalError(BuffLocale.t("The expiry is not a moment in time"))
  return value
}

function parsed<T>(parse: (v: unknown) => T, value: unknown): T {
  try {
    return parse(value)
  } catch (err) {
    if (err instanceof ProtocolError) throw new RefusalError(`share: ${err.code}`)
    throw err
  }
}
