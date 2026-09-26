import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The production CSP lives in index.html. The React dev server injects an inline
 * refresh preamble, so in `vite dev` only we allow inline scripts. Builds keep the
 * policy exactly as written in index.html.
 */
function devCspRelax(): Plugin {
  return {
    name: 'dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    },
  };
}

/** Short commit of the build, written to the Rastreabilidade tab of the exported workbook. */
function appVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  // GitHub Pages serves the site under /<repository>/.
  base: '/AuditAnalyzer/',
  plugins: [react(), devCspRelax()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
