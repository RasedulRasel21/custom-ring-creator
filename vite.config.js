import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// The Appearance page's live preview needs the REAL storefront stylesheet so it
// can never drift from what shoppers see. Importing it directly would make Vite
// serve it at /extensions/custom-ring-creator/assets/... — and `shopify app dev`
// reserves /extensions/* for the theme-extension dev server, which answers 404.
// That broke the route chunk (and so hydration) in dev only. Reading the file
// through a virtual module keeps one source of truth without ever exposing it
// at a URL the CLI proxy can intercept. Inlined at build time, so Vercel's
// serverless bundle needs no access to the extensions folder either.
const STOREFRONT_CSS = "virtual:crc-storefront-css";
const STOREFRONT_CSS_PATH = fileURLToPath(
  new URL("./extensions/custom-ring-creator/assets/diamond-selector.css", import.meta.url),
);

function storefrontCssPlugin() {
  const resolved = "\0" + STOREFRONT_CSS;
  return {
    name: "crc-storefront-css",
    resolveId(id) {
      return id === STOREFRONT_CSS ? resolved : null;
    },
    load(id) {
      if (id !== resolved) return null;
      this.addWatchFile(STOREFRONT_CSS_PATH); // edit the CSS, preview reloads
      return `export default ${JSON.stringify(readFileSync(STOREFRONT_CSS_PATH, "utf8"))};`;
    },
  };
}

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [storefrontCssPlugin(), reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
});
