/**
 * Copies the pieces `next build --output standalone` leaves outside the
 * standalone folder. The Cloud Run image does this in its Dockerfile; the E2E
 * run needs the same layout so it exercises exactly what production serves.
 */
import { cp, rm } from 'node:fs/promises';

const ROOT = 'apps/web';
const STANDALONE = `${ROOT}/.next/standalone/apps/web`;

for (const [from, to] of [
  [`${ROOT}/.next/static`, `${STANDALONE}/.next/static`],
  [`${ROOT}/public`, `${STANDALONE}/public`],
]) {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  console.log(`copied ${from} -> ${to}`);
}
