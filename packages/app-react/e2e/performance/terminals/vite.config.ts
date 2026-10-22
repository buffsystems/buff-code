import { fileURLToPath } from "node:url"
import { mergeConfig } from "vite"
import config from "../../../vite.config"

// The React window's build of the manual terminal benchmark (packages/app/e2e/performance/terminals):
// the same probe, injected only into this build, never into the app build.
const probe = fileURLToPath(new URL("../../../../app/e2e/performance/terminals/probe.ts", import.meta.url))
const src = "/terminal-benchmark-probe.ts"

export default mergeConfig(config, {
  plugins: [
    {
      name: "terminal-benchmark-probe",
      resolveId: (id: string) => (id === src ? probe : undefined),
      transformIndexHtml: {
        order: "pre",
        handler: () => [{ tag: "script", attrs: { type: "module", src }, injectTo: "head" }],
      },
    },
  ],
})
