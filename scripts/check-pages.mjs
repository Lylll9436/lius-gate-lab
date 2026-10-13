import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('dist/pages');
const prefix = (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/';
const html = await readFile(path.join(dir, 'index.html'), 'utf8');
assert(html.includes('<div id="root"></div>') && html.includes('LIU’S GATE'));
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert(url.startsWith(prefix), `Wrong deployed base path: ${url}`);
  await access(path.join(dir, url.slice(prefix.length)));
}
const manifest = JSON.parse(await readFile(path.join(dir, '.vite/manifest.json'), 'utf8'));
assert(manifest['index.html'].dynamicImports.includes('app/city-scene.ts'), 'Scene must remain lazy-loaded.');
// The first download is the entry chunk plus every chunk it imports statically.
const firstDownload = new Set();
for (const queue = ['index.html']; queue.length; ) {
  const entry = manifest[queue.pop()];
  if (firstDownload.has(entry.file)) continue;
  firstDownload.add(entry.file);
  queue.push(...(entry.imports || []));
}
for (const file of firstDownload)
  assert(
    !(await readFile(path.join(dir, file), 'utf8')).includes('WebGLRenderer'),
    `three.js must stay out of the first download; ${file} contains WebGLRenderer. Import sky/clock helpers from app/glasgow-sun.ts (not city-atmosphere or other three-backed modules) and keep app/city-scene.ts behind its dynamic import.`,
  );
for (const entry of Object.values(manifest)) {
  for (const file of [entry.file, ...(entry.css || []), ...(entry.assets || [])])
    await access(path.join(dir, file));
  if (entry.file.endsWith('.js')) {
    const js = await readFile(path.join(dir, entry.file), 'utf8');
    assert(!js.includes('process.env.NEXT_PUBLIC_BASE_PATH'), 'Public asset variable was not replaced.');
    assert(!js.includes('localhost:3000'), 'Local development address in published bundle.');
  }
}
await access(path.join(dir, '.nojekyll'));
console.log('Pages artifact verified: entry, stylesheet, public assets, lazy scene, three-free first download and repository base path.');
