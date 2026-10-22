// Общий переключатель доверия (#457): по умолчанию хуки и команды проекта проверяются.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { BuffTrust } from "@opencode/schema/buff-trust"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Rpc } from "@opencode/core/rpc"
import { BuffTrust as CoreTrust } from "@opencode/core/buff/trust"
import { testEffect } from "../lib/effect"
import { PluginTestLayerWithMcp as PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("BuffTrust policy (#457)", () => {
  it.effect("asks first by default; the person can turn the check off and back on", () =>
    Effect.gen(function* () {
      CoreTrust.forget(CoreTrust.ASK_FIRST)
      const host = yield* PluginHost.make(yield* Plugin.Service)
      yield* CoreTrust.Plugin.effect(host)
      const rpc = (yield* Rpc.Service).client(BuffTrust.Rpc)
      expect(yield* rpc.get()).toEqual({ askFirst: true })
      expect(yield* rpc.set({ askFirst: false })).toEqual({ askFirst: false })
      expect(yield* rpc.get()).toEqual({ askFirst: false })
      yield* rpc.set({ askFirst: true })
      expect(yield* rpc.get()).toEqual({ askFirst: true })
      CoreTrust.forget(CoreTrust.ASK_FIRST)
    }),
  )
})
