// Paint the stored light / dark / system choice before the first frame; mirrors @buff/ui's
// useTheme (the "theme" key, "system" by default). A choice made in the Solid window
// ("opencode-color-scheme") carries over once, and the painted mode is named on <html> as
// data-color-scheme, as the Solid window's theme does.
;(function () {
  try {
    var theme = localStorage.getItem("theme")
    var legacy = localStorage.getItem("opencode-color-scheme")
    if (!theme && (legacy === "light" || legacy === "dark" || legacy === "system")) {
      theme = legacy
      localStorage.setItem("theme", theme)
    }
    var system = !theme || theme === "system"
    var dark = theme === "dark" || (system && matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.toggle("dark", dark)
    document.documentElement.dataset.colorScheme = dark ? "dark" : "light"
  } catch (error) {}
})()
