export * as BuffProjectSlug from "./buff-project-slug.js"

/**
 * Папка проекта веб-клиента (#969): проект называют как угодно, а папка в хранилище человека —
 * латиницей, строчными, через дефис: её читают оболочка, пути в ответах агента и адресная строка.
 * Занятое имя получает номер. Pure.
 */

export const MAX = 48
const FALLBACK = "project"

const LETTERS: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

function base(name: string): string {
  const latin = [...name.toLowerCase()].map((sign) => LETTERS[sign] ?? sign).join("")
  const words = latin.split(/[^a-z0-9]+/).filter(Boolean)
  let out = ""
  for (const word of words) {
    const next = out ? `${out}-${word}` : word
    if (next.length > MAX) break
    out = next
  }
  // Первое же слово длиннее предела — режется оно.
  return out || (words[0] ?? "").slice(0, MAX) || FALLBACK
}

/** Имя папки для проекта `name`; `taken` — имена, уже занятые рядом (регистр не различается). */
export function of(name: string, taken: readonly string[] = []): string {
  const used = new Set(taken.map((item) => item.toLowerCase()))
  const slug = base(name)
  if (!used.has(slug)) return slug
  for (let n = 2; ; n++) if (!used.has(`${slug}-${n}`)) return `${slug}-${n}`
}
