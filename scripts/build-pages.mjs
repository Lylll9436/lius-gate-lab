import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

for (const args of [
  ['scripts/content.mjs', 'validate'],
  ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.pages.config.ts'],
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
await writeFile('dist/pages/.nojekyll', '');
await import('./check-pages.mjs');
