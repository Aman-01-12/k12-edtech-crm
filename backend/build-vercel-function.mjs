import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

/**
 * Bundles the Express app into a single self-contained function for Vercel.
 *
 * Vercel's own build step traces an entry file's imports to decide what to
 * ship, but it does not follow the npm workspace symlink for `@k12/contracts`
 * (an internal package, not something on the npm registry) across the
 * boundary of this project's Root Directory setting. The deployed function
 * then fails at the first request with `ERR_MODULE_NOT_FOUND` for a file that
 * exists on disk here but was never uploaded. See docs/adr/0012.
 *
 * The fix is to not depend on that tracer for the one internal package: this
 * bundles `@k12/contracts` directly into the output and leaves every real npm
 * dependency external, so Vercel only needs to install what `backend/package.json`
 * already declares, which its default install already does correctly.
 */

const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8'));
const external = Object.keys(dependencies).filter((name) => name !== '@k12/contracts');

await build({
  entryPoints: ['src/app.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  logLevel: 'info',
});
