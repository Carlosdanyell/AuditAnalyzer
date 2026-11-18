/**
 * The real CT2 extractions in the XML the system writes, in local/ct2/ (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1):
 * each *.xml is read without error, and when the same extraction is also there as .xlsx (same name, converted by
 * Excel or LibreOffice) and as .zip, the three readings are equal. Failures name only the diverging fields, never the
 * real values. Skipped when there is no XML in local/ct2/.
 */
import { existsSync, openAsBlob, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import type { Ct2FileReconciliation } from '../../src/shared/modules/ct2Integrity';
import { ingestCt2 } from '../../src/worker/modules/ct2Integrity/ingest';
import { localDir } from './realFiles';

const dir = join(localDir, 'ct2');
const xmlFiles = existsSync(dir) ? readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.xml')).sort() : [];

async function read(name: string, blob: Blob) {
  return ingestCt2([{ name, blob }], ct2DefaultConfig(), () => {}, {});
}

/** Fields that differ, by path (no values). */
function differences(a: unknown, b: unknown, path = ''): string[] {
  if (Object.is(a, b)) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return [path || '(raiz)'];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`));
}

/** What depends on the file itself (name, bytes, container, declared dimension, check texts), left out. */
function content(file: Ct2FileReconciliation) {
  const copy: Partial<Ct2FileReconciliation> = structuredClone(file);
  for (const key of ['name', 'size', 'sha256', 'entries', 'format', 'timings'] as const) delete copy[key];
  return { ...copy, rows: { ...file.rows, dimensionRows: null } };
}

describe.skipIf(xmlFiles.length === 0)('real CT2 extractions in XML (local/ct2)', () => {
  for (const name of xmlFiles) {
    it(`${name}: reads whole, like its .xlsx and its .zip`, async () => {
      const xml = await read('extracao', await openAsBlob(join(dir, name)));
      const file = xml.reconciliation.files[0]!;
      expect(file.format).toBe('xml');
      expect(file.rows.balanced).toBe(true);
      expect(file.rows.outsideCells).toBe(0);
      expect(xml.reconciliation.checks.filter((c) => c.severity === 'error' && !c.passed).map((c) => c.id)).toEqual([]);
      console.log(`[xml] ${name}: ${file.rows.detailRows} linhas de detalhe, ${file.header.mapped.length} colunas mapeadas, ` + `alertas: ${file.alerts.length}`);

      const zipped = await read('extracao', new Blob([zipSync({ [name]: readFileSync(join(dir, name)) }) as Uint8Array<ArrayBuffer>]));
      expect(zipped.reconciliation.files[0]!.format).toBe('xmlZip');
      expect(differences(content(zipped.reconciliation.files[0]!), content(file))).toEqual([]);
      expect(differences(zipped.summary, xml.summary)).toEqual([]);

      const xlsxName = name.replace(/\.xml$/i, '.xlsx');
      if (!existsSync(join(dir, xlsxName))) return;
      const xlsx = await read('extracao', await openAsBlob(join(dir, xlsxName)));
      expect(differences(content(file), content(xlsx.reconciliation.files[0]!))).toEqual([]);
      expect(differences(xml.summary, xlsx.summary)).toEqual([]);
    });
  }
});
