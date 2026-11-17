// Applies the theme before the first paint. It replicates resolveTheme/loadThemePref of src/shell/theme.ts
// (test/theme.test.ts checks that they decide the same). It lives in its own file, not inline in index.html,
// so the Content Security Policy needs no 'unsafe-inline' for scripts.
(function () {
  var pref = 'system';
  try {
    var v = localStorage.getItem('ifcx-studio-theme');
    if (v === 'light' || v === 'dark') pref = v;
  } catch (e) {}
  var dark = false;
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {}
  var theme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
