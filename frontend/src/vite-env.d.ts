/// <reference types="vite/client" />

/**
 * Types the environment this bundle may read. Without it `import.meta.env` is
 * `any`, which defeats the point of strict mode at the one boundary where
 * configuration enters the browser.
 *
 * Only `VITE_`-prefixed variables reach the client, so only those belong here.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
