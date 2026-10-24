import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = path.join(root, 'staff-dashboard', 'build');
const destination = path.join(root, 'dist', 'staff');

await fs.rm(destination, { recursive: true, force: true });
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.cp(source, destination, { recursive: true });
console.log(`Packaged staff dashboard in ${path.relative(root, destination)}/`);
