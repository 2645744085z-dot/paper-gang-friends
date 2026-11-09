import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = resolve(root, 'public');
await rm(publicDir, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });
for (const name of ['index.html', 'styles.css', 'app.js', 'ws-client.js']) {
  await cp(resolve(root, name), resolve(publicDir, name));
}
