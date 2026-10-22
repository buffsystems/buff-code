import { defineConfig, devices } from "@playwright/test"
import { upstreamStorageState } from "./e2e/utils/storage-state"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const url = new URL(baseURL)
if (url.protocol !== "http:") throw new Error("E2E fixtures require an http:// app URL")
const built = !!process.env.CI || process.env.PLAYWRIGHT_BUILD === "1"
// Production connects to its own origin, so fixture URLs must match the preview server.
if (built) {
  process.env.PLAYWRIGHT_SERVER_HOST = url.hostname
  process.env.PLAYWRIGHT_SERVER_PORT = url.port || "80"
}
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const command = built
  ? `bun run build && bun run serve -- --host 127.0.0.1 --port ${port} --strictPort`
  : `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`
// Buff (#561): PLAYWRIGHT_APP_DIR=../app-react runs these specs against the React window — the same
// fixtures and mock server, another app under test.
const appDir = process.env.PLAYWRIGHT_APP_DIR
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 5 : 0)) || undefined
export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "service-worker/**",
    process.env.OPENCODE_PERFORMANCE === "1" ? "performance/**/*.test.ts" : "performance/**",
  ],
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command,
        cwd: appDir,
        url: baseURL,
        reuseExistingServer: !built,
        timeout: 120_000,
        env: {
          VITE_OPENCODE_TEST_FIXTURES: "1",
          VITE_OPENCODE_SERVER_HOST: serverHost,
          VITE_OPENCODE_SERVER_PORT: serverPort,
        },
      },
  use: {
    baseURL,
    storageState: upstreamStorageState(baseURL),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Pages load the app through Playwright (e2e/utils/test.ts), so their document has no loopback
    // address and Local Network Access would gate the page's requests to other loopback ports
    // (fixture servers) that a page served from the loopback server makes freely.
    launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
