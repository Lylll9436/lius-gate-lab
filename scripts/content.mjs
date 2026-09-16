import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertCatalog,
  migrateCatalog,
  collections,
  upsertRecord,
  removeRecord,
} from '../app/content-schema.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'content/lab.json');
const [command = 'validate', collection, input] = process.argv.slice(2);
const before = await fs.readFile(file, 'utf8'),
  catalog = migrateCatalog(JSON.parse(before));
assertCatalog(catalog);
async function checkAssets(data) {
  for (const item of [...data.people, ...data.events]) {
    const asset = item.photo ?? item.image;
    if (asset) await fs.access(path.join(root, 'public', asset.slice(1)));
  }
}
try {
  if (command === 'validate') {
    await checkAssets(catalog);
    console.log(
      'Catalog valid. ' +
        catalog.people.length +
        ' people, ' +
        catalog.research.length +
        ' research records, ' +
        catalog.events.length +
        ' events.',
    );
  } else if (command === 'list') {
    if (collection && !collections.includes(collection))
      throw new Error('Unknown collection.');
    console.log(
      JSON.stringify(collection ? catalog[collection] : catalog, null, 2),
    );
  } else if (command === 'upsert' || command === 'remove') {
    if (!collections.includes(collection) || !input)
      throw new Error(
        'Usage: content.mjs ' +
          command +
          ' people|research|events|outputs|notes record.json|id',
      );
    const next =
      command === 'upsert'
        ? upsertRecord(
            catalog,
            collection,
            JSON.parse(await fs.readFile(path.resolve(input), 'utf8')),
          )
        : removeRecord(catalog, collection, input);
    await checkAssets(next);
    const backups = path.join(root, 'work/content-backups');
    await fs.mkdir(backups, { recursive: true });
    const backup = path.join(
      backups,
      Date.now() + '-' + crypto.randomUUID() + '.json',
    );
    await fs.writeFile(backup, before, { flag: 'wx' });
    const pending = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(pending, JSON.stringify(next, null, 2) + '\n', {
      flag: 'wx',
    });
    // Reject a concurrent manual edit instead of silently overwriting it.
    if ((await fs.readFile(file, 'utf8')) !== before) {
      await fs.unlink(pending);
      throw new Error(
        'Catalog changed during editing; retry against the latest file.',
      );
    }
    await fs.rename(pending, file);
    console.log(
      'Saved ' + collection + '. Backup: ' + path.relative(root, backup),
    );
  } else
    throw new Error(
      'Commands: validate, list [collection], upsert collection record.json, remove collection id',
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
