import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import appReact from "./vite.plugin.ts"

export default defineConfig({
  plugins: [appReact, tailwindcss()],
  resolve: {
    // Modules reused from the Solid app import each other through its "@/" alias.
    alias: { "@": fileURLToPath(new URL("../app/src", import.meta.url)) },
  },
  // Module workers, as the Solid window builds them: the markdown worker loads Shiki's languages
  // and themes on demand instead of inlining every one of them (10 MB parsed on start, slow
  // highlighting).
  worker: { format: "es" },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    // The e2e fixture pages are built too, so the built window (PLAYWRIGHT_BUILD=1) serves them.
    ...(process.env.VITE_OPENCODE_TEST_FIXTURES === "1"
      ? { rolldownOptions: { input: ["index.html", "e2e/utils/settings-wsl.html", "e2e/utils/app-direction.html"] } }
      : {}),
    assetsDir: "_assets",
    target: "esnext",
    sourcemap: true,
  },
})
