import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { BuffBrand } from "../../buff/brand.js"

export const ZenmuxPlugin = define({
  id: "opencode.provider.zenmux",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@opencode/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://zenmux.ai/api/v1") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            "HTTP-Referer": BuffBrand.ATTRIBUTION.referer,
            "X-Title": BuffBrand.ATTRIBUTION.title,
            ...provider.headers,
          }
        })
      }
    })
  }),
})
