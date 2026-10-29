# 0012. The deployed API function is a committed esbuild bundle, not the raw TypeScript source

Status: accepted

## Context

The backend is one workspace in an npm workspaces monorepo and imports `@k12/contracts`, a sibling workspace package, via a plain `node_modules/@k12/contracts` symlink that npm creates at install time.

Vercel's Project is configured with Root Directory `backend`, which is the standard way to deploy one workspace of a monorepo. Three ways of pointing Vercel at the Express app were tried, in order:

1. **The "Express" framework zero-config preset**, pointed at `src/app.ts`. Its TypeScript diagnostic pass rejected `import helmet from 'helmet'` with `TS2349: This expression is not callable`, even though the same file type-checks cleanly with `tsc` locally under three different `tsconfig.json` shapes (extending the shared base config, fully inlined, with and without an explicit `esModuleInterop: true`). The preset does not document how to influence this internal check, and it is new enough (announced in Vercel's docs dated after this project's design) that its interaction with npm workspaces is unproven.

2. **The classic `api/` serverless function convention**, with `api/index.ts` re-exporting the app from `src/app.ts`. This cleared the TypeScript error, but the deployed function crashed on its first request:

   ```
   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
   '/var/task/node_modules/@k12/contracts/src/index.ts'
   imported from /var/task/backend/src/errors/app-error.js
   ```

   Vercel's file tracer, which decides what to include in the deployed function, ships the backend's own `node_modules` correctly but does not follow the workspace symlink to pull in `packages/contracts/src/*.ts` from outside Root Directory. The file exists on disk at build time; it simply never reaches the deployed function.

3. A custom `installCommand` (`cd .. && npm ci`) was tried as a fix for case 2, on the theory that a full workspace install would help the tracer. It made no observable difference: the deployed function's dependency count stayed at the count produced by installing only `backend/package.json`'s own dependencies, both with and without the custom command present in `vercel.json`. Whatever Vercel's classic function builder does for its own dependency install, it does not appear to honor this key for a plain Node function in the way it does for a framework-detected zero-config build.

## Decision

Do not ask Vercel's build pipeline to resolve the workspace dependency at all.

`backend/build-vercel-function.mjs` runs esbuild against `src/app.ts`, bundling `@k12/contracts` directly into the output (the only import that needs to cross the workspace boundary) and marking every real npm dependency (`express`, `pg`, `bcrypt`, `helmet`, and the rest of `backend/package.json`'s own `dependencies`) as external, so they are still installed normally rather than bundled. The result, `backend/api/index.js`, is a single self-contained file plus the dependencies Vercel's default install for `backend/package.json` already provides correctly.

This file is committed. `npm run build:vercel` (run from `backend/`) regenerates it, and it must be regenerated and committed whenever `src/` or the `@k12/contracts` package changes before the next deploy.

`backend/vercel.json` adds a catch-all rewrite, `"/(.*) -> /api/index"`, because the classic `api/` convention maps `api/index.js` to the single route `/api`, while the Express app expects to see every path (`/api/health`, `/api/v1/auth/login`, ...) itself and do its own routing.

## Alternatives considered

**Keep chasing the Express framework preset's TypeScript check.**
Rejected for now: three different tsconfig shapes were tried and none satisfied it, and the preset gives no documented hook to inspect or override its own compiler options.

**Hand-author a Build Output API v3 directory and deploy with `vercel deploy --prebuilt`.**
This is the "real" fix in the sense that it uses Vercel's documented lower-level interface instead of relying on either higher-level convention. Rejected for this deadline: it requires constructing `.vercel/output/config.json` and the function manifest by hand, which is a bigger surface to get wrong than one esbuild call, for the same outcome.

**Give `@k12/contracts` a real build step and publish compiled JS.**
Would make the package resolvable the normal way and is the better long-term fix if this project grows more deployed services. Rejected for now as more machinery than a three-file shared-schema package needs; revisit if a second deployed service needs the same package.

## Consequences

A backend change that does not touch `src/` or `packages/contracts` needs no rebuild. A change that does requires `cd backend && npm run build:vercel` and committing the updated `api/index.js` before redeploying, which is easy to forget. This is recorded in the README's deployment section as the one manual step the normal `git push` workflow does not cover.
