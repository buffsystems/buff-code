;(function () {
  // Buff (#471): тема одна — Buff (id «oc-2»); цвета рамки — BUFF_FRAME из ui/src/theme/buff.ts.
  var themeId = "oc-2"

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"
  var frame = isDark ? "#12151c" : "#f1f5f9"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = frame

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", frame)
})()
