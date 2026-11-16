// Shared helpers for the Playwright test suite.
import { chromium, firefox, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ART = path.join(ROOT, 'tests', 'artifacts');
fs.mkdirSync(ART, { recursive: true });
export const PORT = +(process.env.PORT || 8792);
export const BASE = `http://localhost:${PORT}/index.html`;

let server = null;
/** Start the no-cache dev server on a test-only port (8792) unless one is already up. */
export async function startServer() {
  try { const r = await fetch(BASE); if (r.ok) return; } catch (e) { /* not running */ }
  server = spawn('python3', [path.join(ROOT, 'tools', 'serve.py'), String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE)).ok) return; } catch (e) { /* wait */ } await sleep(200); }
  throw new Error('dev server did not start');
}
export function stopServer() { server?.kill(); }
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const BROWSERS = {
  chromium: () => chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }),
  firefox: () => firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } }),
  webkit: () => webkit.launch({ headless: true }),
};

/** Open the game, collecting console errors, page errors, failed requests and 404s. */
export async function openGame(browser, query = '', { denyLock = false, viewport = { width: 1280, height: 720 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|GL Driver|WebGL: INVALID|texImage/.test(m.text())) problems.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => { if (!/fonts\.g/.test(r.url())) problems.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  if (denyLock) await page.addInitScript(() => {
    Element.prototype.requestPointerLock = function () { const e = new Event('pointerlockerror'); setTimeout(() => document.dispatchEvent(e), 0); throw new DOMException('Pointer lock denied (test)', 'NotAllowedError'); };
  });
  await page.goto(BASE + (query ? (query.startsWith('?') ? query : '?' + query) : ''), { waitUntil: 'load' });
  return { ctx, page, problems };
}
export async function waitReady(page, timeout = 120000) {
  await page.waitForFunction(() => window.__game?.ready === true || !!document.querySelector('#fatal.show'), null, { timeout });
  const fatal = await page.evaluate(() => document.querySelector('#fatal.show')?.textContent || null);
  if (fatal) throw new Error('startup error overlay: ' + fatal);
}

/** Tiny test runner: register tests, run, print PASS/FAIL, exit nonzero on failure. */
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export async function run(title) {
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  let pass = 0, fail = 0; const results = [];
  console.log(`\n=== ${title} ===`);
  for (const t of tests) {
    if (only && !only.test(t.name)) continue;
    const t0 = Date.now();
    try { await t.fn(); pass++; results.push({ name: t.name, ok: true, ms: Date.now() - t0 }); console.log(`PASS  ${t.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`); }
    catch (e) { fail++; results.push({ name: t.name, ok: false, err: String(e.message || e) }); console.log(`FAIL  ${t.name}\n      ${String(e.message || e).split('\n').join('\n      ')}`); }
  }
  console.log(`--- ${title}: ${pass} passed, ${fail} failed ---`);
  fs.writeFileSync(path.join(ART, `${title.replace(/\W+/g, '_')}.json`), JSON.stringify({ pass, fail, results }, null, 2));
  stopServer();
  process.exitCode = fail ? 1 : 0;
  return { pass, fail };
}
export function assert(c, msg) { if (!c) throw new Error(msg); }
