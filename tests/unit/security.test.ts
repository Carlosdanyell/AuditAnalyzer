import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

// Policy from docs/ARQUITETURA.md, section 7.
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " +
  "connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('no data leaves the machine', () => {
  it('index.html declares exactly the documented Content-Security-Policy', () => {
    const match = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    expect(match?.[1]).toBe(EXPECTED_CSP);
  });

  it('index.html references no external resource', () => {
    expect(indexHtml).not.toMatch(/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it('source code has no external URLs or network APIs', () => {
    const offenders = filesUnder(join(root, 'src')).filter((file) => {
      // XML namespace names of the Office Open XML format are identifiers, never fetched.
      const text = readFileSync(file, 'utf8').replace(/http:\/\/schemas\.openxmlformats\.org\/[\w/.-]+/g, '');
      return /https?:\/\//.test(text) || /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('storage APIs other than IndexedDB are not used', () => {
    const offenders = filesUnder(join(root, 'src')).filter((file) =>
      /\b(localStorage|sessionStorage|caches\.|serviceWorker)\b/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
