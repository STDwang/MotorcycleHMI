import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'dist');
// Only remove this repository's direct dist directory, never a redirected target.
if (dirname(target) !== root || basename(target) !== 'dist') throw new Error('Unsafe build target');
try {
  if (await realpath(target) !== target) throw new Error('Build target must not be a symlink');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(resolve(root, 'web'), target, { recursive: true });
await writeFile(resolve(target, '.nojekyll'), '');
console.log(`Static game built: ${target}`);
