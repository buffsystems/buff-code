import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { Effect, FileSystem, Path } from "effect"
import { NodeServices } from "@effect/platform-node"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { testEffect } from "../../../../core/test/lib/effect"
import { RemoteCli } from "./cli"

const it = testEffect(NodeServices.layer)
// These scripts execute on the POSIX remote host, not the Windows desktop.
const posix = process.platform === "win32" ? it.live.skip : it.live

it.live(
  "resolves the latest Buff release and rejects unavailable or invalid metadata",
  Effect.gen(function* () {
    for (const response of [
      Response.json({ channel: "latest", version: "2.0.11-buff.25" }),
      Response.json({ version: '2.0.11"; whoami' }),
      Response.json({ version: "2.0.11-buff.25" }, { status: 503 }),
    ]) {
      const result = yield* RemoteCli.latestRelease().pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            expect(request.url).toBe("https://buff.systems/update/api/latest/cli/npm")
            return Effect.succeed(HttpClientResponse.fromWeb(request, response))
          }),
        ),
        Effect.result,
      )
      if (response.status === 200 && result._tag === "Success") expect(result.success).toBe("2.0.11-buff.25")
      else expect(result._tag).toBe("Failure")
    }
  }),
)

posix(
  "discovers the managed CLI by default and uses PATH only when requested",
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "remote-cli-" })
    const home = path.join(dir, "home with ' quotes")
    yield* fs.makeDirectory(path.join(home, ".buff/bin"), { recursive: true })
    yield* fs.makeDirectory(path.join(dir, "bin"))
    const managed = path.join(home, ".buff/bin/buff")
    const external = path.join(dir, "bin/buff")
    yield* fs.writeFileString(managed, "#!/bin/sh\nprintf 'buff v2.0.11-buff.25\\n'\n", { mode: 0o755 })
    yield* fs.writeFileString(external, "#!/bin/sh\nprintf 'buff v2.0.11-buff.26\\n'\n", { mode: 0o755 })
    const run = (script: string) =>
      spawner.string(
        ChildProcess.make("sh", ["-c", script], {
          env: { HOME: home, PATH: `${path.join(dir, "bin")}:/usr/bin:/bin` },
        }),
      )
    expect((yield* run(RemoteCli.discoverScript())).trim()).toBe(managed)
    expect((yield* run(RemoteCli.discoverScript({ fromPath: true }))).trim()).toBe(external)
    expect(RemoteCli.parseVersion(yield* run(RemoteCli.versionScript(RemoteCli.quote(managed))))).toBe(
      "2.0.11-buff.25",
    )
    yield* fs.remove(managed)
    expect((yield* run(RemoteCli.discoverScript())).trim()).toBe("")
    expect(RemoteCli.parseVersion(yield* run(RemoteCli.versionScript(RemoteCli.quote(managed))))).toBeNull()
  }),
)

test("pins Buff release artifacts and rejects unsafe inputs", () => {
  expect(RemoteCli.archiveUrl("linux-x64-baseline-musl", "2.0.11-buff.25")).toBe(
    "https://buff.systems/downloads/2.0.11-buff.25/buff-linux-x64-baseline-musl.tar.gz",
  )
  expect(RemoteCli.sumsUrl("2.0.11-buff.25")).toBe("https://buff.systems/downloads/2.0.11-buff.25/SHA256SUMS")
  expect(() => RemoteCli.installScript({ version: '2.0.0"; whoami', source: { type: "archive" } })).toThrow()
  expect(() => RemoteCli.archiveUrl("linux-x64;whoami", "2.0.0")).toThrow()
})

test("a host's download rides out a stalled connection to the release site", () => {
  const script = RemoteCli.installScript({
    version: "2.0.11-buff.25",
    source: {
      type: "download",
      url: RemoteCli.archiveUrl("linux-x64-baseline", "2.0.11-buff.25"),
      sums: RemoteCli.sumsUrl("2.0.11-buff.25"),
      file: RemoteCli.archiveName("linux-x64-baseline"),
    },
  })
  expect(script).toContain("curl -fsSL --connect-timeout 10 --retry 4 --retry-delay 2")
  expect(script).toContain("wget -q -t 5 -T 180")
})

test("checks an archive against the release checksums before it is uploaded", () => {
  const archive = new TextEncoder().encode("archive bytes")
  const digest = createHash("sha256").update(archive).digest("hex")
  const sums = `${"0".repeat(64)}  buff-darwin-arm64.tar.gz\n${digest}  buff-linux-x64-baseline.tar.gz\n`
  expect(RemoteCli.matchesChecksum(archive, sums, "linux-x64-baseline")).toBe(true)
  expect(RemoteCli.matchesChecksum(archive, sums, "darwin-arm64")).toBe(false)
  expect(RemoteCli.matchesChecksum(archive, sums, "linux-arm64")).toBe(false)
})

posix(
  "installs the release archive with its ripgrep and git, downloaded, uploaded or from a local binary",
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "remote-install-" })
    const release = path.join(dir, "release")
    yield* fs.makeDirectory(path.join(release, "buff-git/bin"), { recursive: true })
    yield* fs.writeFileString(path.join(release, "buff"), "#!/bin/sh\nprintf 'buff v2.0.11-buff.25\\n'\n", {
      mode: 0o755,
    })
    yield* fs.writeFileString(path.join(release, "buff-rg"), "#!/bin/sh\n", { mode: 0o755 })
    yield* fs.writeFileString(path.join(release, "buff-git/bin/git"), "#!/bin/sh\n", { mode: 0o755 })
    const archive = path.join(dir, "buff-linux-x64-baseline.tar.gz")
    expect(
      yield* spawner.exitCode(
        ChildProcess.make("tar", ["-czf", archive, "-C", release, "buff", "buff-rg", "buff-git"], { extendEnv: true }),
      ),
    ).toBe(0)
    const digest = createHash("sha256")
      .update(yield* fs.readFile(archive))
      .digest("hex")
    let sums = `${digest}  buff-linux-x64-baseline.tar.gz\n`
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) =>
        new URL(request.url).pathname === "/SHA256SUMS" ? new Response(sums) : new Response(Bun.file(archive)),
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
    const home = path.join(dir, "home")
    yield* fs.makeDirectory(home)
    const run = (input: Parameters<typeof RemoteCli.installScript>[0]) =>
      spawner.exitCode(
        ChildProcess.make("sh", ["-c", RemoteCli.installScript(input)], {
          env: { HOME: home },
          extendEnv: true,
          stdin: fs.stream(archive),
        }),
      )
    const download = {
      type: "download" as const,
      url: new URL("/buff-linux-x64-baseline.tar.gz", server.url).href,
      sums: new URL("/SHA256SUMS", server.url).href,
      file: "buff-linux-x64-baseline.tar.gz",
    }
    expect(yield* run({ version: "2.0.11-buff.25", source: download })).toBe(0)
    expect(yield* fs.readFileString(path.join(home, ".buff/bin/buff"))).toContain("2.0.11-buff.25")
    expect((yield* fs.readDirectory(path.join(home, ".buff/bin"))).toSorted()).toEqual(["buff", "buff-git", "buff-rg"])
    expect(yield* fs.exists(path.join(home, ".buff/bin/buff-git/bin/git"))).toBe(true)

    sums = `${"0".repeat(64)}  buff-linux-x64-baseline.tar.gz\n`
    expect(
      yield* run({ version: "2.0.11-buff.25", directory: ".buff/desktop-ssh/2.0.11-buff.25", source: download }),
    ).not.toBe(0)
    expect(yield* fs.exists(path.join(home, ".buff/desktop-ssh/2.0.11-buff.25/buff"))).toBe(false)

    expect(
      yield* run({ version: "2.0.11-buff.25", directory: ".buff/desktop-ssh/2.0.11-buff.25", source: { type: "archive" } }),
    ).toBe(0)
    expect(yield* fs.readFileString(path.join(home, ".buff/desktop-ssh/2.0.11-buff.25/buff"))).toContain("2.0.11")
    expect(yield* run({ version: "2.0.11-buff.26", source: { type: "archive" } })).not.toBe(0)
    expect(yield* fs.readFileString(path.join(home, ".buff/bin/buff"))).toContain("2.0.11-buff.25")

    const local = path.join(home, ".buff/local")
    expect(
      yield* run({
        version: "2.0.11-buff.25",
        directory: ".buff/local",
        source: { type: "binary", path: RemoteCli.quote(path.join(release, "buff")) },
      }),
    ).toBe(0)
    expect(yield* fs.readDirectory(local)).toEqual(["buff"])
  }),
)
