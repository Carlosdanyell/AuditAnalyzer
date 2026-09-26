/** Real files in local/ for the local tests (never versioned; see local/LEIA-ME.md). */
import { existsSync, openAsBlob, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig } from '../../src/config/schema';
import { mergeImport } from '../../src/shared/justifications';
import { runIngestion } from '../../src/worker/ingest/pipeline';
import { readJustificationWorkbook } from '../../src/worker/justifications/importWorkbook';
import { Session } from '../../src/worker/session';

export const localDir = join(import.meta.dirname, '..', '..', 'local');
const goldenPath = join(localDir, 'golden.json');
const golden = existsSync(goldenPath)
  ? (JSON.parse(readFileSync(goldenPath, 'utf8')) as { arquivo_agosto?: { nome_esperado: string }; arquivo_setembro?: { nome_esperado: string } })
  : null;

/** Names of the CFGR700 files listed in golden.json that are present. */
export const realInputs = [golden?.arquivo_agosto?.nome_esperado, golden?.arquivo_setembro?.nome_esperado].filter(
  (n): n is string => !!n && existsSync(join(localDir, n)),
);

export async function realSession(): Promise<Session> {
  const config = defaultConfig();
  const result = await runIngestion(
    await Promise.all(realInputs.map(async (name) => ({ name, blob: await openAsBlob(join(localDir, name)) }))),
    config,
    () => {},
  );
  return new Session(result, config);
}

/** Loads the justifications of a previous workpaper found in local/ (any other .xlsx with justification tabs). */
export async function loadPreviousJustifications(session: Session): Promise<number> {
  const candidates = readdirSync(localDir).filter((n) => n.toLowerCase().endsWith('.xlsx') && !realInputs.includes(n));
  for (const name of candidates) {
    const blob = await openAsBlob(join(localDir, name));
    try {
      await readJustificationWorkbook(blob);
    } catch {
      continue; // not a workpaper
    }
    const preview = await session.previewImport(Object.assign(blob, { name: 'anterior.xlsx' }));
    const lasts = preview.loadedFiles.map((f) => f.lastEvent ?? 0);
    const merged = mergeImport([], preview.items, {
      coverage: { files: preview.coverage.files, lastEvent: preview.coverage.lastEvent },
      confirmedCoverage: { files: preview.loadedFiles.map((f) => f.name), lastEvent: Math.max(...lasts) },
      replace: new Set(),
      now: 0,
    });
    session.setJustifications(merged.items, true);
    return merged.items.length;
  }
  return 0;
}
