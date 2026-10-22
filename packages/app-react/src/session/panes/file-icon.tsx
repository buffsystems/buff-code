// A file's or folder's icon in the panes (#584): a lucide glyph by kind of file, standing in for
// the Solid window's per-language sprite (its chooser lives in a Solid component).

import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  type LucideIcon,
} from "lucide-react"

const BY_EXTENSION: Record<string, LucideIcon> = {}
const assign = (icon: LucideIcon, extensions: string) =>
  extensions.split(" ").forEach((extension) => (BY_EXTENSION[extension] = icon))
assign(
  FileCode,
  "ts tsx js jsx mjs cjs py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish ps1 lua sql vue svelte astro html css scss less dart scala ex exs erl hs ml zig nim r",
)
assign(FileJson, "json jsonc json5")
assign(FileText, "md mdx markdown txt rst adoc log")
assign(FileImage, "png jpg jpeg gif webp avif bmp ico svg tif tiff heic")
assign(FileAudio, "mp3 wav ogg m4a aac flac opus")
assign(FileVideo, "mp4 m4v webm mov ogv")
assign(FileArchive, "zip tar gz tgz bz2 xz 7z rar")
assign(FileSpreadsheet, "csv tsv xls xlsx")
assign(FileCog, "toml yaml yml ini env conf cfg lock")

export function fileIconFor(path: string, type: "file" | "directory", expanded = false): LucideIcon {
  if (type === "directory") return expanded ? FolderOpen : Folder
  const name = path.split(/[\\/]/).pop() ?? ""
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return name.startsWith(".") ? FileCog : File
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? File
}

export function FileIcon(props: { path: string; type?: "file" | "directory"; expanded?: boolean; className?: string }) {
  const Icon = fileIconFor(props.path, props.type ?? "file", props.expanded)
  return <Icon data-component="file-icon" aria-hidden className={props.className ?? "size-4 shrink-0"} />
}
