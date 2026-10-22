// Buff: S3-совместимое хранилище в памяти для тестов — ровно то, чем пользуется адаптер
// (`src/core/storage.ts`): объекты по пути и список ListObjectsV2. Тестам не нужен облачный бакет.
export function startMemoryS3() {
  const objects = new Map<string, string>()
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      const [, bucket, ...rest] = url.pathname.split("/")
      const key = decodeURIComponent(rest.join("/"))
      if (!bucket) return new Response("no bucket", { status: 400 })
      if (!key && request.method === "GET" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? ""
        const after = url.searchParams.get("start-after") ?? ""
        const max = Number(url.searchParams.get("max-keys") ?? "1000")
        const keys = [...objects.keys()]
          .filter((name) => name.startsWith(prefix) && name > after)
          .sort()
          .slice(0, max)
        const contents = keys.map((name) => `<Contents><Key>${escape(name)}</Key></Contents>`).join("")
        return new Response(`<?xml version="1.0"?><ListBucketResult>${contents}</ListBucketResult>`, {
          headers: { "content-type": "application/xml" },
        })
      }
      if (request.method === "PUT") {
        objects.set(key, await request.text())
        return new Response(null, { status: 200 })
      }
      if (request.method === "DELETE") {
        objects.delete(key)
        return new Response(null, { status: 204 })
      }
      const value = objects.get(key)
      return value === undefined ? new Response("not found", { status: 404 }) : new Response(value)
    },
  })
  return { endpoint: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
