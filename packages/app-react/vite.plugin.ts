import { readFileSync } from "node:fs"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"

// The desktop renderer compiles Solid and React side by side: each JSX plugin owns only its own
// folders, so React Refresh never wraps a Solid module and Solid's compiler never sees React (the
// design system ships React sources too; Refresh still skips node_modules).
export const reactSources = [
  /\/packages\/app-react\/src\/.*\.[jt]sx?$/,
  /\/src\/renderer-react\/.*\.[jt]sx?$/,
  /\/@buff\/ui\/src\/.*\.[jt]sx?$/,
]

// Vite loads its config under Node, so this reads with node:fs rather than Bun.file.
const themeBootScript = readFileSync(new URL("./theme-boot.js", import.meta.url), "utf8")

// Pages of this window carry an empty `<script id="buff-theme-boot">`; it is filled with the theme
// boot script so the first frame already has the right mode. Other pages are left untouched.
const themeBoot: Plugin = {
  name: "buff:theme-boot",
  transformIndexHtml: {
    order: "pre",
    handler: (html) =>
      html.replace(
        '<script id="buff-theme-boot"></script>',
        `<script id="buff-theme-boot">${themeBootScript}</script>`,
      ),
  },
}

export default [react({ include: reactSources }), themeBoot]
