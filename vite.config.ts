import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * Ship the same CSP shape in the built frontend as in tauri.conf.json.
 *
 * Tauri injects its configured policy at runtime; this meta tag makes the
 * production policy visible to `vite preview` and Playwright too. Dev keeps
 * `'unsafe-inline'` only for Vite's React refresh preamble; the built app has
 * strict `script-src 'self'`, which is the security property under test.
 */
function cspPlugin(): Plugin {
  return {
    name: "pocketlibrary-csp",
    transformIndexHtml(html, context) {
      const dev = context.server !== undefined;
      const content = dev
        ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' ws: http: https:; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'self' blob:; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'none'";
      return html.replace(
        "</head>",
        `    <meta http-equiv="Content-Security-Policy" content="${content}" />\n  </head>`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), cspPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
