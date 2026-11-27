// Collects the built-in charts plugin's view and every example block of its guide, references
// and examples folder into a directory — for the design system's scripts/render-blocks.ts, which
// draws each of them in the real frame. Usage: bun script/chart-blocks.ts <out dir>
import { BuffChatPlugin } from "@opencode/schema/buff-chat-plugin"
import { BuffChatPluginBuiltin } from "../src/buff/chat-plugin/builtin/index"
const { charts } = BuffChatPluginBuiltin
const out = process.argv[2] ?? "."
await Bun.write(`${out}/view.html`, charts.files["view.html"]!)
const blocks: { name: string; block: string; text: string }[] = []
for (const [file, text] of Object.entries(charts.files)) {
  if (file.startsWith("examples/")) {
    blocks.push({ name: "example-" + file.slice(9, -3), block: "chart", text: BuffChatPlugin.exampleOf(text)!.text })
    continue
  }
  if (!file.endsWith(".md")) continue
  const base = file
    .replace(/^guide\//, "")
    .replace(/\.md$/, "")
    .toLowerCase()
  ;[...text.matchAll(/```(?:chart|json)\n([\s\S]*?)\n```/g)].forEach((match, index) =>
    blocks.push({ name: `${base}-${index + 1}`, block: "chart", text: match[1]! }),
  )
}
await Bun.write(`${out}/blocks.json`, JSON.stringify(blocks, null, 1))
console.log(blocks.length, "blocks")
