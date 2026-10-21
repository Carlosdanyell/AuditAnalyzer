import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { suggestModule } from '../../src/modules/registry';
import type { AvailableModule } from '../../src/modules/types';
import type { SheetSample, WorkerEvent } from '../../src/shared/protocol';
import { createCommandHandler } from '../../src/worker/handler';
import { buildCfgr700 } from '../synthetic/cfgr700';
import { buildCt2Extraction } from '../synthetic/ct2Extraction';
import { fileA as ct2FileA } from '../synthetic/ct2Fixtures';
import { fileA as logFileA } from '../synthetic/fixtures';

/** Probe of the start screen and detect() of each module (docs/MODULOS.md, sections 3.1 and 4). */
const file = (bytes: Uint8Array, name: string) => new File([bytes as Uint8Array<ArrayBuffer>], name);
const ct2 = () => file(buildCt2Extraction(ct2FileA({ extraSheets: { Resumo: [['Totais']] } })), 'ct2.xlsx');
const log = () => file(buildCfgr700(logFileA()), 'log.xlsx');

async function probe(files: File[]): Promise<(SheetSample[] | null)[]> {
  const events: WorkerEvent[] = [];
  await createCommandHandler((e) => events.push(e))({ type: 'probe', requestId: 7, files, rows: 30 });
  expect(events).toHaveLength(1);
  const answer = events[0]!;
  if (answer.type !== 'probe' || answer.requestId !== 7) throw new Error(JSON.stringify(answer));
  return answer.files;
}

const configOf = (m: AvailableModule) => (m.config.saved ? defaultConfig() : m.config.defaults());

describe('probe of the first rows', () => {
  it('gives the first rows of every sheet as text, shared strings resolved', async () => {
    const [sample] = await probe([ct2()]);
    expect(sample!.map((s) => s.name)).toEqual(['Resumo', 'SCACKST0.XML']);
    const rows = sample![1]!.rows;
    expect(rows[0]).toEqual({ r: 1, titles: ['CT2 - Lancamentos Contabeis'] });
    expect(rows[1]!.r).toBe(3);
    expect(rows[1]!.titles.slice(0, 2)).toEqual(['Data Lcto   ', 'Numero Lote ']);
    expect(rows.length).toBeLessThanOrEqual(30);
  });

  it('answers null for a file it cannot read, never an error', async () => {
    const samples = await probe([file(new TextEncoder().encode('não é um xlsx'), 'texto.xlsx'), log()]);
    expect(samples[0]).toBeNull();
    expect(samples[1]).not.toBeNull();
  });
});

describe('detect and the suggestion of another analysis', () => {
  it('recognizes each input by its header, under the configuration of the module', async () => {
    const [ct2Sample, logSample] = await probe([ct2(), log()]);
    expect(ct2IntegrityModule.detect(ct2Sample!, ct2IntegrityModule.config.defaults())).toBe('match');
    expect(ct2IntegrityModule.detect(logSample!, ct2IntegrityModule.config.defaults())).toBe('no');
    expect(cfgr700Module.detect(logSample!, defaultConfig())).toBe('match');
    expect(cfgr700Module.detect(ct2Sample!, defaultConfig())).toBe('no');
    // Titles of the CFGR700 are configurable: another title is no longer recognized.
    const renamed = defaultConfig();
    renamed.columns.user = 'Usuário do sistema';
    expect(cfgr700Module.detect(logSample!, renamed)).toBe('no');
    expect(cfgr700Module.detect([], defaultConfig())).toBe('maybe');
  });

  it('suggests the analysis a file belongs to, only when the chosen one does not recognize it', async () => {
    const [ct2Sample, logSample] = await probe([ct2(), log()]);
    expect(suggestModule(ct2IntegrityModule, [ct2Sample, logSample, undefined, null], configOf)).toEqual({ module: cfgr700Module, files: [1] });
    expect(suggestModule(cfgr700Module, [logSample, ct2Sample], configOf)).toEqual({ module: ct2IntegrityModule, files: [1] });
    expect(suggestModule(cfgr700Module, [logSample, undefined], configOf)).toBeNull();
  });
});
