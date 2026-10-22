export * as RemoteCli from "./cli"

import { Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { BuffLinks } from "@opencode/schema/buff-links"
import { parseCliVersion } from "../service/cli-version"

export class Failure extends Schema.TaggedError<Failure>()("RemoteCliFailure", {
  code: Schema.Literals(["platform", "version", "install"]),
  detail: Schema.String,
}) {
  override get message() {
    return this.detail
  }
}

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function requireVersion(version: string) {
  if (version !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(version))
    throw new Failure({ code: "version", detail: version })
  return version
}

export function discoverScript(options: { fromPath?: boolean; cache?: { directory: string; prefix: string } } = {}) {
  return `cli=${options.fromPath ? "$(command -v buff || true)" : '""'}
if [ -z "$cli" ] && [ -x "$HOME/.buff/bin/buff" ]; then cli="$HOME/.buff/bin/buff"; fi
${
  options.cache
    ? `if [ -z "$cli" ]; then
  for binary in "$HOME"/${quote(options.cache.directory)}/${quote(options.cache.prefix)}*/buff; do
    if [ -x "$binary" ]; then cli="$binary"; fi
  done
fi
`
    : ""
}if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
`
}

// Adapters supply a quoted shell expression, including remote HOME or wslpath expansion.
export function versionScript(command: string) {
  return `if [ -x ${command} ]; then ${command} --version 2>/dev/null || true; fi\n`
}

export function parseVersion(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
  return line ? parseCliVersion(line) : null
}

export const probeScript = `set -eu
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$os" in linux|darwin) ;; *) exit 2 ;; esac
case "$arch" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) exit 2 ;; esac
target="$os-$arch"
if [ "$arch" = x64 ]; then target="$target-baseline"; fi
if [ "$os" = linux ]; then
  if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then target="$target-musl"; fi
fi
printf 'OPENCODE_REMOTE_TARGET=%s\\n' "$target"
`

export function parseTarget(output: string) {
  return output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith("OPENCODE_REMOTE_TARGET="))
    ?.split("=")[1]
}

// Buff (#597): the remote side gets Buff's own console from its releases — the archives `buff/install`
// installs, with the bundled ripgrep and git — never upstream's npm packages or installer.
export function archiveUrl(target: string, version: string) {
  if (!/^(linux|darwin)-(x64-baseline|arm64)(-musl)?$/.test(target))
    throw new Failure({ code: "platform", detail: target })
  return `${BuffLinks.downloads}/${requireVersion(version)}/${archiveName(target)}`
}

export function sumsUrl(version: string) {
  return `${BuffLinks.downloads}/${requireVersion(version)}/SHA256SUMS`
}

export function archiveName(target: string) {
  return `buff-${target}.tar.gz`
}

/** The desktop checks an archive it is about to upload; a host that downloads checks it itself. */
export function matchesChecksum(archive: Uint8Array, sums: string, target: string) {
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1]?.replace(/^\*/, "") === archiveName(target))?.[0]
  return expected !== undefined && expected === createHash("sha256").update(archive).digest("hex")
}

type Source =
  | { type: "download"; url: string; sums: string; file: string }
  | { type: "archive" }
  | { type: "binary"; path: string }

export function installScript(input: { version: string; directory?: string; source: Source; linkPath?: boolean }) {
  const version = requireVersion(input.version)
  return `set -eu
umask 077
destination="$HOME"/${quote(input.directory ?? ".buff/bin")}
mkdir -p "$destination"
stage=$(mktemp -d "$destination/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT
${stageRelease(input.source)}
chmod 755 "$stage/buff"
${verifyScript('"$stage/buff"', version)}
if [ -f "$stage/buff-rg" ]; then mv -f "$stage/buff-rg" "$destination/buff-rg"; fi
if [ -d "$stage/buff-git" ]; then rm -rf "$destination/buff-git"; mv "$stage/buff-git" "$destination/buff-git"; fi
mv -f "$stage/buff" "$destination/buff"
${input.linkPath ? linkPathScript : ""}`
}

// As `buff/install` does: shells that do not find `buff` get the install directory on their PATH.
const linkPathScript = `if ! command -v buff >/dev/null 2>&1; then
  line="export PATH=\\"$destination:\\$PATH\\""
  for profile in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    if [ ! -f "$profile" ] || grep -qF "$destination" "$profile"; then continue; fi
    printf '\\n# Buff Code\\n%s\\n' "$line" >> "$profile"
  done
fi
`

function stageRelease(source: Source) {
  if (source.type === "binary") return `cp ${source.path} "$stage/buff"`
  if (source.type === "archive") return 'cat > "$stage/release.tar.gz"\ntar -xzf "$stage/release.tar.gz" -C "$stage"'
  // Connections to the release site can stall for seconds at a time; each request retries rather
  // than failing the whole install on one stalled connection.
  return `fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 --retry 4 --retry-delay 2 --max-time 180 "$1" -o "$2"
  else wget -q -t 5 -T 180 -O "$2" "$1"; fi
}
fetch ${quote(source.url)} "$stage/release.tar.gz"
fetch ${quote(source.sums)} "$stage/SHA256SUMS"
expected=$(awk -v f=${quote(source.file)} '$2 == f || $2 == "*"f {print $1}' "$stage/SHA256SUMS" | head -n 1)
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$stage/release.tar.gz" | awk '{print $1}')
else actual=$(shasum -a 256 "$stage/release.tar.gz" | awk '{print $1}'); fi
[ -n "$expected" ] && [ "$expected" = "$actual" ]
tar -xzf "$stage/release.tar.gz" -C "$stage"`
}

function verifyScript(command: string, version: string) {
  return `test "$(${command} --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(version)}`
}

const Release = Schema.Struct({ version: Schema.String.check(Schema.isPattern(/^[0-9][a-zA-Z0-9.+-]*$/)) })

/** The latest released console — for a desktop run from source, whose own version is unpublished. */
export const latestRelease = Effect.fn("RemoteCli.latestRelease")(function* () {
  const http = yield* HttpClient.HttpClient
  const metadata = yield* http.get(BuffLinks.latestCli).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Release)),
    Effect.timeout("30 seconds"),
    Effect.mapError(() => new Failure({ code: "install", detail: BuffLinks.latestCli })),
  )
  return metadata.version
})
