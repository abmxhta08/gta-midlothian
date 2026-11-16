// Global error handling. Startup errors show a full-screen overlay; runtime errors show a small
// banner while the game keeps running (the main loop is guarded so one bad frame cannot freeze it).
const seen = new Map();
let bar = null, fatal = null, game = null;

export function installErrorHandling(g) {
  game = g;
  fatal = document.getElementById('fatal'); bar = document.getElementById('errbar');
  addEventListener('error', (e) => report(e.error || e.message, `${(e.filename || '').split('/').pop()}:${e.lineno || '?'}`));
  addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'));
}

export function report(err, where = '') {
  const msg = String(err?.message || err || 'Unknown error');
  const stack = String(err?.stack || '').split('\n').slice(0, 4).join('\n');
  const key = msg + where;
  seen.set(key, (seen.get(key) || 0) + 1);
  console.error('[Midlothian]', msg, where, stack);
  if (!game?.ready) return showFatal(msg, where, stack);
  if (!bar) return;
  const n = [...seen.values()].reduce((a, b) => a + b, 0);
  bar.textContent = `Error: ${msg}${where ? ` (${where})` : ''}${n > 1 ? `  ×${n}` : ''} — the game kept running. Press F3 for details.`;
  bar.classList.add('show'); clearTimeout(bar._t); bar._t = setTimeout(() => bar.classList.remove('show'), 8000);
}

export function showFatal(msg, where, stack = '') {
  if (!fatal) fatal = document.getElementById('fatal');
  if (!fatal) return;
  fatal.querySelector('.msg').textContent = `${msg}${where ? `  (${where})` : ''}`;
  fatal.querySelector('.stack').textContent = stack;
  fatal.classList.add('show');
}

export const errorLog = () => [...seen.entries()].map(([k, n]) => ({ error: k, count: n }));
