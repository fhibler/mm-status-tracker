/* Resolves the theme before first paint (avoids a light/dark flash): loaded in <head>, before the page is drawn. */
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('mm-status-tracker:theme') || 'system'; } catch (e) { /* storage unavailable */ }
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
