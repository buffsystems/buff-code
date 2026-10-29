// Buff (#639): машина как пир ретранслятора buff.systems. Телефон, сопряжённый с машиной, — её
// владелец: команды идут в мобильный API (api.ts) поверх сервера Buff Code. Связь со шлюзом
// поднимается, только когда она нужна (есть телефоны или начато сопряжение): машина без телефонов
// на шлюзе не регистрируется. Сессии, сопряжение и регистрация — общий код пира из
// @buff/mobile-protocol, тот же, что у установок.
import {
  fromB64u,
  PairingEngine,
  RefusalError,
  RelayHost,
  RelayLink,
  registerPeer,
  sealPush,
  type DeviceRecord,
  type LocalPeer,
  type PairingView,
  type PeerLog,
  type PushMessage,
  type RelayConn,
  type Reply,
} from "@buff/mobile-protocol"
import type { Home } from "./home.js"
import type { MobileStore } from "./store.js"
import { BuffLocale } from "../locale.js"

/** Кто действует с телефона на машине: её владелец. */
export const OWNER = "owner"

/** Телефон спрашивает, куда вошла машина, при каждом подключении (#684); смена дома приходит событием. */
export const HOME_OP = "machine.home"
export const HOME_STREAM = "machine.home"

/** Дом машины, как его видит телефон: имя и вид установки; null — без входа в Buff. */
export type PhoneHome = { name: string; kind: Home["kind"] } | null

export interface AgentPorts {
  store: MobileStore
  connect(token: string): Promise<RelayConn>
  /** Шлюз: buff.systems или стенд. */
  gatewayHost: string
  /** Как машина называется на телефоне. */
  display(): string
  exec(record: DeviceRecord, op: string, args: unknown): Promise<Reply>
  now(): number
  log?: PeerLog
}

export interface Phone {
  device: string
  display: string
  paired: number
  online: boolean
  seen: number | null
}

export interface AgentStatus {
  gateway: string
  connected: boolean
  problem: string | null
  phones: number
  /** Установка, куда вошёл Buff Code, и запрещены ли там телефоны; без входа — null. */
  home: { name: string; kind: "saas" | "install"; forbidden: boolean } | null
}

export class MobileAgent {
  private link: RelayLink | null = null
  private local: LocalPeer | null = null
  private home: Home | null = null
  /** Дом ещё не проверялся с запуска: телефону нечего сказать, он держит, что знал. */
  private homeChecked = false
  private readonly host: RelayHost
  private readonly engine: PairingEngine
  readonly p: AgentPorts

  constructor(ports: AgentPorts) {
    this.p = ports
    this.host = new RelayHost({
      device: async (_peer, device) => ports.store.device(device),
      pairs: () => this.link?.pairs() ?? [],
      exec: (record, op, args) =>
        op === HOME_OP ? Promise.resolve({ ok: true, ...this.homeAnswer() }) : ports.exec(record, op, args),
      publish: (subject, bytes) => this.link?.publish(subject, bytes),
      log: ports.log,
    })
    this.engine = new PairingEngine({
      gateway: (_local, command, body) => this.request(command, body),
      saveDevice: (record) => ports.store.saveDevice(record),
      gatewayHost: ports.gatewayHost,
      now: ports.now,
      log: ports.log,
    })
  }

  /** При запуске службы: связь — если уже есть сопряжённые телефоны. */
  async start(): Promise<void> {
    const active = (await this.p.store.devices()).filter((d) => !d.revoked)
    if (active.length) await this.ensure()
  }

  async stop(): Promise<void> {
    await this.link?.stop()
    this.link = null
  }

  /** Пир машины на шлюзе — когда связь уже поднималась. */
  get id(): string | null {
    return this.local?.identity.id ?? null
  }

  status(phones: number): AgentStatus {
    return {
      gateway: this.p.gatewayHost,
      connected: this.link?.connected ?? false,
      problem: this.link?.problem ?? null,
      phones,
      home: this.home && { name: this.home.name, kind: this.home.kind, forbidden: this.home.forbidden },
    }
  }

  /**
   * Дом машины по входу в Buff (#639): шлюз узнаёт его при следующей регистрации — сразу, если
   * связь уже есть. Дом запретил телефоны — начатые сопряжения отменяются, пары рвутся здесь и
   * на шлюзе.
   */
  async setHome(home: Home | null): Promise<void> {
    const moved = home?.peer !== this.home?.peer
    const renamed = !this.homeChecked || home?.name !== this.home?.name || home?.kind !== this.home?.kind
    this.home = home
    this.homeChecked = true
    if (moved && this.link) await this.link.refresh("home changed")
    if (renamed) await this.tellHome()
    if (!home?.forbidden) return
    for (const offer of this.engine.offers(OWNER)) this.engine.cancel(offer.offerId, OWNER)
    for (const device of (await this.p.store.devices()).filter((d) => !d.revoked)) await this.revoke(device.device)
  }

  /** Ответ на `machine.home`: до первой проверки — без поля, телефон держит, что знал. */
  homeAnswer(): { home?: PhoneHome } {
    if (!this.homeChecked) return {}
    return { home: this.home && { name: this.home.name, kind: this.home.kind } }
  }

  // Смена дома — событием сопряжённым телефонам с живой сессией; остальные спросят при подключении.
  private async tellHome(): Promise<void> {
    const record = this.homeAnswer()
    for (const device of (await this.p.store.devices()).filter((d) => !d.revoked))
      this.push(device.device, { kind: "event", stream: HOME_STREAM, record })
  }

  async phones(): Promise<Phone[]> {
    const live = new Set(this.host.sessionList().map((s) => s.device))
    const id = this.local?.identity.id ?? ""
    return (await this.p.store.devices())
      .filter((d) => !d.revoked)
      .map((d) => ({
        device: d.device,
        display: d.display,
        paired: d.created,
        online: live.has(d.device),
        seen: this.host.seen(id, d.device),
      }))
  }

  /** Новое сопряжение по QR или коду; связь со шлюзом поднимается, если её ещё не было. */
  async offer(kind: "qr" | "code"): Promise<PairingView> {
    if (this.home?.forbidden)
      throw new RefusalError(
        BuffLocale.t(
          "Pairing phones is forbidden by the policy of «{name}»: Buff Code is signed in there, and its rules apply to this machine.",
          { name: this.home.name },
        ),
      )
    const local = await this.ensure()
    if (!this.link?.connected)
      throw new RefusalError(
        BuffLocale.t("No link to the gateway {gateway}: check the internet — the connection retries by itself.", {
          gateway: this.p.gatewayHost,
        }),
      )
    return this.engine.start(local, kind, OWNER, null, this.p.display())
  }

  view(offerId: string): PairingView {
    return this.engine.view(offerId, OWNER)
  }

  offers(): PairingView[] {
    return this.engine.offers(OWNER)
  }

  async confirm(offerId: string): Promise<PairingView> {
    return this.engine.confirm(offerId, OWNER)
  }

  cancel(offerId: string): void {
    this.engine.cancel(offerId, OWNER)
  }

  async rename(device: string, display: string): Promise<void> {
    await this.p.store.rename(device, display.trim())
  }

  /** Телефон отключён с машины: пара отзывается на шлюзе, его сессия здесь кончается сразу. */
  async revoke(device: string): Promise<void> {
    const record = await this.p.store.revoke(device, this.p.now())
    if (!record) return
    if (this.local) this.host.drop(this.local.identity.id, device)
    await this.request("revoke", { pairId: record.pairId })
  }

  /**
   * Уведомление сопряжённым телефонам через push шлюза (#636), запечатанное для каждого: шлюз,
   * Apple и Google видят шифртекст. Кому `skip` говорит «и так смотрит» — не шлётся. Без связи со
   * шлюзом — ничего: уведомление не копится.
   */
  async notify(message: PushMessage, skip: (device: string) => boolean = () => false): Promise<number> {
    const local = this.local
    if (!local || !this.link?.connected) return 0
    let sent = 0
    for (const device of (await this.p.store.devices()).filter((d) => !d.revoked && !skip(d.device))) {
      const push = sealPush(local.identity, { id: device.device, dhPublic: fromB64u(device.dh) }, message)
      if ((await this.request("push_send", { to: device.device, push })).ok) sent++
    }
    return sent
  }

  /** Событие на сопряжённые телефоны с живой сессией (таймлайн, разрешения, вопросы). */
  push(device: string, payload: Parameters<RelayHost["push"]>[2]): void {
    if (this.local) this.host.push(this.local.identity.id, device, payload)
  }

  private request(command: string, body: object): Promise<Reply> {
    return this.link?.request(command, body) ?? Promise.resolve({ ok: false, error: "relay: not connected" })
  }

  private async ensure(): Promise<LocalPeer> {
    if (this.local && this.link) return this.local
    const identity = await this.p.store.identity()
    const local: LocalPeer = { identity, kind: "machine", org: null }
    const link = new RelayLink({
      local,
      token: () =>
        registerPeer(
          identity,
          { kind: "machine", display: this.p.display(), ...(this.home ? { home: this.home.peer } : {}) },
          (t) => this.p.connect(t),
          this.p.now() * 1000,
        ),
      connect: (t) => this.p.connect(t),
      host: this.host,
      engine: this.engine,
      now: this.p.now,
      log: this.p.log,
    })
    ;[this.local, this.link] = [local, link]
    await link.start()
    return local
  }
}
