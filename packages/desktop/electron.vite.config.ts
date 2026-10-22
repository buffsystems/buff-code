import { defineConfig } from "electron-vite"
import { pickerPlugin } from "./scripts/picker"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

const nodePtyPkg = `@lydell/node-pty-${process.platform}-${process.arch}`

const appPlugin = (await import("@opencode/app/vite")).default
// Buff (#561): the desktop window is the React window. The app plugin still gives the renderer its
// config (the "@" alias the reused modules import through, the channel, module workers), Tailwind
// and the Buff CSS passes; only Solid's compiler is left out, since no Solid page is built.
const { default: reactPlugin } = await import("@opencode/app-react/vite")
const appPlugins = appPlugin.filter((plugin) => !(plugin && "name" in plugin && plugin.name === "solid"))
const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? (await import("@sentry/vite-plugin")).sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./out/renderer/**",
          filesToDeleteAfterUpload: "./out/renderer/**/*.map",
        },
      })
    : false

// Every module an entry reaches through static imports lands in one chunk per entry. Automatic
// splitting otherwise fragments the initial graph into ~50 files shared with lazy routes, and each
// file costs the renderer a main-thread request round trip through the main process before first
// paint. Buff (#561): the Solid window ("app") and the React window ("react") are separate entries;
// modules both reach statically go to one "shared" chunk, so neither window loads the other.
type ChunkingContext = { getModuleInfo(id: string): { isEntry: boolean; importers: readonly string[] } | null }
const initialEntries = new WeakMap<ChunkingContext, Map<string, ReadonlySet<string>>>()
function reachingEntries(id: string, ctx: ChunkingContext) {
  const memo = initialEntries.get(ctx) ?? new Map<string, ReadonlySet<string>>()
  initialEntries.set(ctx, memo)
  const visit = (id: string, path: Set<string>): ReadonlySet<string> => {
    const known = memo.get(id)
    if (known !== undefined) return known
    if (path.has(id)) return new Set()
    const info = ctx.getModuleInfo(id)
    if (!info) return new Set()
    path.add(id)
    const result = new Set(info.importers.flatMap((importer) => [...visit(importer, path)]))
    if (info.isEntry) result.add(id)
    path.delete(id)
    memo.set(id, result)
    return result
  }
  return visit(id, new Set())
}
function initialChunk(id: string, ctx: ChunkingContext) {
  const entries = [...reachingEntries(id, ctx)]
  if (entries.length === 0) return null
  const react = entries.filter((entry) => entry.endsWith("/src/renderer/react.html")).length
  if (react === 0) return "app"
  return react === entries.length ? "react" : "shared"
}

export default defineConfig(({ command }) => ({
  main: {
    resolve: {
      dedupe: ["effect"],
    },
    define: {
      // Local renderer/server mode still uses the dev application identity and updater policy.
      "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel === "local" ? "dev" : channel),
    },
    build: {
      minify: command === "build",
      rolldownOptions: {
        input: { index: "src/main/index.ts" },
        // Keep this identical to electron-vite's Node 20.11+ shim. Its regex insertion can
        // corrupt bundled TypeScript, while an output banner places the shim safely.
        output: {
          format: "es",
          // DesktopPaths resolves resources from the main output directory,
          // including when the lazy desktop entry shares it with other chunks.
          chunkFileNames: "[name]-[hash].js",
          banner: `
// -- CommonJS Shims --
import __cjs_mod__ from 'node:module';
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require = __cjs_mod__.createRequire(import.meta.url);
`,
        },
      },
      externalizeDeps: {
        // Bundle the Effect family together.
        exclude: ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm"],
        include: [nodePtyPkg],
      },
    },
    plugins: [
      {
        name: "opencode:node-pty-narrower",
        enforce: "pre",
        resolveId(s) {
          if (s === "@lydell/node-pty") return nodePtyPkg
          return undefined
        },
      },
    ],
  },
  preload: {
    build: {
      minify: command === "build",
      rolldownOptions: {
        input: { index: "src/preload/index.ts" },
        output: {
          format: "cjs",
          // The package is "type": "module". Under --no-sandbox Electron loads the preload
          // through Node's module loader, which treats a .js file as ESM and fails on
          // require("electron"). The sandboxed path ignores the extension.
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    experimental: {
      bundledDev: true,
    },
    define: {
      "import.meta.env.OPENCODE_VERSION": JSON.stringify(process.env.OPENCODE_VERSION),
      "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
      "import.meta.env.OPENCODE_TEST_ONBOARDING": JSON.stringify(
        command === "serve" && process.env.OPENCODE_TEST_ONBOARDING === "1",
      ),
    },
    plugins: [pickerPlugin(), appPlugins, reactPlugin, sentry],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: {
      minify: command === "build",
      sourcemap: true,
      rolldownOptions: {
        input: {
          react: "src/renderer/react.html",
        },
        output: {
          codeSplitting: {
            groups: [
              // Claimed first, so neither window's group pulls a shared module into its own chunk.
              { name: (id, ctx) => (initialChunk(id, ctx) === "shared" ? "shared" : null), priority: 20 },
              { name: (id, ctx) => initialChunk(id, ctx), priority: 10 },
            ],
          },
        },
      },
    },
  },
}))
