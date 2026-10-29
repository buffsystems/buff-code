import { execFile } from "node:child_process"
import { stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { CustomMacSignOptions } from "app-builder-lib"
import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
const metainfoFpm = (appId: string) =>
  `${path.join(packageDir, "resources", `${appId}.metainfo.xml`)}=/usr/share/metainfo/${appId}.metainfo.xml`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

export function macSignOptions(options: CustomMacSignOptions): CustomMacSignOptions {
  return {
    ...options,
    optionsForFile: (file) => {
      const defaults = options.optionsForFile?.(file)
      if (file !== path.join(options.app, "Contents/Resources/buff")) return defaults ?? {}
      // The Bun CLI loads bun-pty's native library; Electron and its helpers do not need this exception.
      return { ...defaults, entitlements: path.join(packageDir, "resources/entitlements.cli.plist") }
    },
  }
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (raw === "latest") return "prod"
  return "dev"
})()

const APP_IDS = {
  dev: "systems.buff.code.dev",
  beta: "systems.buff.code.beta",
  prod: "systems.buff.code",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "buff-code-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "systems.buff.code" becomes
  // "systems.buff.code.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: [
    "out/**/*",
    "resources/**/*",
    "!resources/buff",
    "!resources/buff.*",
    "!resources/buff-dev*",
    "!resources/buff-wsl*",
    "!resources/buff-rg*",
    "!resources/buff-git{,/**/*}",
    // Log export imports Zip.js as ESM. Keep index.js and lib, including its inline worker.
    "!**/node_modules/@zip.js/zip.js/dist{,/**/*}",
    "!**/node_modules/@zip.js/zip.js/{index.cjs,index.min.js,index-fflate.js,deno.json,eslint.config.mjs}",
    // Nothing executes type declarations or source maps, and every entry costs startup time: the
    // main process parses the whole asar header before it runs any JavaScript.
    "!**/node_modules/**/*.d.{ts,cts,mts}",
    "!**/node_modules/**/*.d.{ts,cts,mts}.map",
    "!**/node_modules/**/*.{js,cjs,mjs}.map",
    // These packages execute compiled JavaScript, not their sources.
    "!**/node_modules/ajv/lib{,/**/*}",
    "!**/node_modules/ajv-formats/src{,/**/*}",
    // Keep js-yaml's CommonJS sources and dist/js-yaml.mjs ESM entry, not browser bundles or its CLI.
    "!**/node_modules/js-yaml/dist/{js-yaml.js,js-yaml.min.js,*.map}",
    "!**/node_modules/js-yaml/bin{,/**/*}",
  ],
  extraResources: [
    {
      from: "resources/",
      to: "",
      // Buff: buff-rg — ripgrep для поиска по файлам без сети, рядом с консолью.
      filter: ["buff", "buff.exe", "buff.version", "buff-rg", "buff-rg.exe"],
    },
    // Buff (#495): встроенный git — снимкам сессии нужен git от 2.35, на Windows его может не быть вовсе.
    { from: "resources/buff-git", to: "buff-git", filter: ["**/*"] },
  ],
  afterPack: async (context) => {
    const cli = path.join(
      context.packager.getResourcesDir(context.appOutDir),
      context.electronPlatformName === "win32" ? "buff.exe" : "buff",
    )
    const file = await stat(cli)
    if (!file.isFile() || file.size === 0) throw new Error(`Bundled CLI must be a non-empty file: ${cli}`)
    const version = path.join(path.dirname(cli), "buff.version")
    if ((await stat(version)).size === 0) throw new Error(`Bundled CLI version must be a non-empty file: ${version}`)
    const ripgrep = path.join(path.dirname(cli), context.electronPlatformName === "win32" ? "buff-rg.exe" : "buff-rg")
    if (!(await stat(ripgrep).catch(() => undefined))?.size) throw new Error(`Bundled ripgrep is missing: ${ripgrep}`)
    if (context.electronPlatformName !== "darwin") {
      const git = path.join(
        path.dirname(cli),
        "buff-git",
        ...(context.electronPlatformName === "win32" ? ["cmd", "git.exe"] : ["libexec", "git-core", "git"]),
      )
      if (!(await stat(git).catch(() => undefined))?.size) throw new Error(`Bundled git is missing: ${git}`)
    }

    // Buff: macOS-пакет мы собираем на Linux, где electron-builder подпись пропускает.
    // Без подписи приложение на Apple Silicon не запустится вообще, поэтому подписываем
    // ad-hoc сторонним инструментом. Порядок важен: сначала вложенный в Resources CLI
    // (он обычный файл, а не вложенный бандл), потом внешний бандл — иначе его печать
    // окажется снятой с уже изменённого содержимого.
    if (context.electronPlatformName === "darwin" && process.platform !== "darwin") {
      const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
      await execFileAsync("rcodesign", ["sign", cli])
      await execFileAsync("rcodesign", ["sign", ripgrep])
      // Без флага runtime (hardened runtime): при нём macOS грузит только библиотеки того же
      // Team ID, а у ad-hoc подписи его нет — dyld отказывался загрузить Electron Framework
      // («different Team IDs», проверено на macOS 27). Hardened runtime нужен лишь для
      // нотаризации Apple, которой без платной учётки у нас нет.
      await execFileAsync("rcodesign", ["sign", bundle])
    }
  },
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    extendInfo: {
      NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
    },
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    sign: async (options) => {
      const { sign } = await import("app-builder-lib/out/codeSign/macCodeSign")
      await sign(macSignOptions(options))
    },
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "Buff Code",
    schemes: ["buff"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    include: path.join(packageDir, "resources", "windows", "installer.nsh"),
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Buff Code Dev",
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "buff-code-dev", fpm: [metainfoFpm(appId)] },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Buff Code Beta",
        protocols: { name: "Buff Code Beta", schemes: ["buff"] },
        publish: {
          provider: "generic",
          url: "https://buff.systems/update/api/beta/desktop/buff-code/",
          channel: "latest",
        },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "buff-code-beta", fpm: [metainfoFpm(appId)] },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Buff Code",
        protocols: { name: "Buff Code", schemes: ["buff"] },
        publish: {
          provider: "generic",
          url: "https://buff.systems/update/api/latest/desktop/buff-code/",
          channel: "latest",
        },
        deb: { fpm: [metainfoFpm(appId)] },
        rpm: { packageName: "buff-code", fpm: [metainfoFpm(appId)] },
      }
    }
  }
}

export default getConfig()
