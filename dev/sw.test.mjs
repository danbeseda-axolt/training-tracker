// The service worker must cache exactly the files the page needs, at the
// exact module URLs the page imports. node --test "tracker/dev/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(new URL('../index.html', import.meta.url)));
const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SHELL = JSON.parse(sw.match(/const SHELL\s*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));
const bare = u => u.split('?')[0];

test('VERSION is ledger-v5-21 and matches the ?v= on every module import', () => {
  assert.equal(sw.match(/const VERSION\s*=\s*'([^']+)'/)[1], 'ledger-v5-21');
  const vs = [...html.matchAll(/from '\.\/[^'?]+\?v=([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(vs, ['5-21', '5-21', '5-21', '5-21', '5-21', '5-21', '5-21', '5-21']);
});

test('SHELL holds the page, the eight modules, the manifest and the icon', () => {
  for (const f of ['./', './index.html', './engine.js', './sync.js', './cloud.js', './library.js', './programme.js', './coach.js', './logview.js', './progress.js', './manifest.json', './icon.svg'])
    assert.ok(SHELL.map(bare).includes(f), f);
});

test('every servable file at the tracker root except sw.js is in SHELL', () => {
  const files = readdirSync(ROOT).filter(f => /\.(js|html|json|svg)$/.test(f) && f !== 'sw.js');
  for (const f of files) assert.ok(SHELL.map(bare).includes('./' + f), f + ' missing from SHELL');
});

test('the module URLs index.html imports are exactly the ones SHELL caches', () => {
  const scripts = html.match(/<script[^>]*>/g);
  assert.deepEqual(scripts, ['<script type="module">'], 'one inline module script, no <script src>');
  assert.doesNotMatch(html, /<link[^>]+stylesheet/);
  const imports = [...html.matchAll(/from '(\.\/[^']+)'/g)].map(m => m[1]);
  assert.equal(imports.length, 8);
  for (const u of imports) assert.ok(SHELL.includes(u), u + ' is imported but not cached under that URL');
  const sync = readFileSync(path.join(ROOT, 'sync.js'), 'utf8');
  assert.doesNotMatch(sync, /^import /m, 'sync.js imports nothing, so it cannot load a second engine');
  const cloud = readFileSync(path.join(ROOT, 'cloud.js'), 'utf8');
  assert.doesNotMatch(cloud, /^import /m, 'cloud.js imports nothing either');
  for (const f of ['library.js', 'programme.js', 'coach.js', 'logview.js', 'progress.js'])
    assert.doesNotMatch(readFileSync(path.join(ROOT, f), 'utf8'), /^import /m, f + ' imports nothing: the library is passed in');
});

test('the worker never handles the GitHub API and falls back to index.html only for navigation', () => {
  assert.match(sw, /api\.github\.com'\) return/);
  assert.match(sw, /req\.mode === 'navigate' \? await cache\.match\('\.\/index\.html'\)/);
  assert.match(sw, /if \(res\.ok\) cache\.put/);
  assert.match(sw, /url\.origin !== self\.location\.origin\) return/, 'cross-origin calls (Supabase) are never handled');
});

test('the shell lists exactly the versioned module URLs the page imports, and nothing from training/ or the data repo', () => {
  assert.deepEqual(SHELL, ['./', './index.html', './engine.js?v=5-21', './sync.js?v=5-21', './cloud.js?v=5-21', './library.js?v=5-21', './programme.js?v=5-21', './coach.js?v=5-21', './logview.js?v=5-21', './progress.js?v=5-21', './manifest.json', './icon.svg']);
  for (const u of SHELL) assert.doesNotMatch(u, /training|log\//);
});

/* 5-21: a duplicate declaration in the inline module stopped the app at boot
   and no test noticed. The page's module script must parse. */
test('the inline module script in index.html parses', async () => {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'liftless-')), 'page.mjs');
  writeFileSync(f, src);
  execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
});
