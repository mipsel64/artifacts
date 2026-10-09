// Anti-flash theme boot. Runs before the stylesheet: applies the stored explicit
// choice ('light' | 'dark') as data-theme on <html>; 'system' / absent = follow
// prefers-color-scheme. Classic script on purpose (must run before first paint).
(function () {
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch (e) {
    /* Private mode: fall back to prefers-color-scheme. */
  }
})();
