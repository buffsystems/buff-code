import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "systems.buff.code" : `systems.buff.code.${channel}`
const productName = channel === "prod" ? "Buff Code" : `Buff Code ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `Средство агентной разработки Buff${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="systems.buff">
    <name>Buff</name>
  </developer>

  <description>
    <p>
      Buff Code — средство агентной разработки: работает с пространством вашей организации,
      её знаниями, репозиториями и моделями.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="homepage">https://buff.systems</url>

</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
