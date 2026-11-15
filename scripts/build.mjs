import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'dist');
await mkdir(target, { recursive: true });
await cp(resolve(root, 'web'), target, { recursive: true });
await writeFile(resolve(target, '.nojekyll'), '');
console.log(`Static game built: ${target}`);
