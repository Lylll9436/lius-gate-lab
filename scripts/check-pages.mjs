import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

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
// Of the town modules, page code may import only town-plan; the rest is three-backed scene code
// for the lazy city-scene chunk. The bundle cannot show a slip (Vite folds a module the entry
// imports into the entry chunk, under no town- name, and tree-shaking can drop WebGLRenderer),
// so walk the static imports from index.html's module script in the source. Specifiers resolve
// through tsconfig.json (so `@/app/town-…` counts too) and next/image as vite.pages.config.ts
// maps it; type-only imports are skipped, because TypeScript and Vite drop them.
const entryModule = path.resolve('app/pages-entry.tsx');
assert(
  (await readFile('index.html', 'utf8')).includes('src="/app/pages-entry.tsx"'),
  'index.html must load app/pages-entry.tsx.',
);
const { config } = ts.readConfigFile('tsconfig.json', (file) => ts.sys.readFile(file));
const compilerOptions = ts.parseJsonConfigFileContent(config, ts.sys, path.resolve('.')).options;
/** The module specifiers of a file's value-carrying static imports and re-exports. */
const staticImports = (source) =>
  source.statements.flatMap((s) => {
    if (ts.isImportDeclaration(s)) {
      const clause = s.importClause,
        named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
      if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
      if (clause && !clause.name && named.length && named.every((e) => e.isTypeOnly)) return [];
      return [s.moduleSpecifier.text];
    }
    if (ts.isExportDeclaration(s) && s.moduleSpecifier) {
      const named = s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements : [];
      if (s.isTypeOnly || (named.length && named.every((e) => e.isTypeOnly))) return [];
      return [s.moduleSpecifier.text];
    }
    return [];
  });
const importedBy = new Map([[entryModule, null]]);
for (const file of importedBy.keys()) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const spec of staticImports(source)) {
    const target =
      spec === 'next/image'
        ? path.resolve('app/static-image.tsx')
        : ts.resolveModuleName(spec, file, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
    if (!target || target.includes(`${path.sep}node_modules${path.sep}`)) continue;
    if (/\.tsx?$/.test(target) && !target.endsWith('.d.ts') && !importedBy.has(target)) importedBy.set(target, file);
  }
}
const chain = (file) => (file ? [...chain(importedBy.get(file)), path.relative('.', file)] : []);
for (const needed of ['app/page.tsx', 'app/town-plan.ts'])
  assert(importedBy.has(path.resolve(needed)), `The import walk never reached ${needed}; module resolution is broken.`);
for (const file of importedBy.keys())
  assert(
    !/^app\/town-(?!plan\.ts$)[\w-]+\.ts$/.test(path.relative('.', file)),
    `Page code imports ${chain(file).join(' -> ')}. Of the town modules only town-plan may be imported from page code; the rest loads with app/city-scene.ts behind its dynamic import.`,
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
// Fonts are self-hosted: Google Fonts is blocked or slow in mainland China, where a
// blocked stylesheet leaves visitors waiting on a blank or unstyled page.
const cssUrl = /url\(\s*(?:(['"])(.*?)\1|([^'")\s]+))\s*\)/g;
const built = await readdir(dir, { recursive: true, withFileTypes: true });
let fontFiles = 0;
for (const entry of built) {
  if (!entry.isFile() || !/\.(?:html|css)$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  const name = path.relative(dir, file);
  const text = await readFile(file, 'utf8');
  for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com'])
    assert(!text.includes(host), `${name} loads ${host}; self-host fonts.`);
  if (!file.endsWith('.css')) continue;
  // Every url() in the built CSS, fonts included, must point at an emitted file.
  for (const [, , quoted, bare] of text.matchAll(cssUrl)) {
    const url = (quoted ?? bare).split(/[?#]/)[0];
    if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) continue;
    if (url.startsWith('/'))
      assert(url.startsWith(prefix), `Wrong deployed base path: ${url}`);
    const target = url.startsWith('/')
      ? path.join(dir, url.slice(prefix.length))
      : path.resolve(path.dirname(file), url);
    await access(target).catch(() =>
      assert.fail(`${name} references ${url}, which was not emitted.`),
    );
    if (url.endsWith('.woff2')) fontFiles++;
  }
}
assert(fontFiles > 0, 'The built CSS must load the self-hosted woff2 fonts.');
await access(path.join(dir, '.nojekyll'));
console.log('Pages artifact verified: entry, stylesheet, public assets, self-hosted fonts, lazy scene, three-free first download, town modules out of page code and repository base path.');
