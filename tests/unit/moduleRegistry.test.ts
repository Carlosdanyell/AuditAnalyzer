import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ct2DefaultConfig } from '../../src/config/ct2IntegritySchema';
import { defaultConfig } from '../../src/config/schema';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { ct2IntegrityModule } from '../../src/modules/ct2Integrity/module';
import { MODULES, getModule, resolveInitialModule } from '../../src/modules/registry';
import { configHash } from '../../src/shared/configTools';
import { DEFAULT_MODULE_ID, MODULE_IDS } from '../../src/shared/modules';

/** The modules of the platform (docs/MODULOS.md). */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe('module registry', () => {
  it('lists every module once, in the order of the ids', () => {
    expect(MODULE_IDS).toEqual(['cfgr700', 'ct2Integrity']);
    expect(MODULES.map((m) => m.id)).toEqual([...MODULE_IDS]);
    expect(DEFAULT_MODULE_ID).toBe('cfgr700');
  });

  it('describes the CFGR700 module with its current rules', async () => {
    expect(getModule('cfgr700')).toBe(cfgr700Module);
    const m = cfgr700Module;
    expect(m.status).toBe('available');
    expect(m.title).toBe('Log de auditoria (CFGR700)');
    expect(m.accepts).toEqual({ extensions: ['.xlsx'], maxFiles: 255 });
    expect(m.helpAnchor).toBe('cfgr700');
    expect(m.preview).toBeNull();
    expect(m.features).toEqual({ panel: true, tables: true, justifications: true, export: true });
    expect(m.config.saved).toBe(true);
    expect(m.config.defaults()).toEqual(defaultConfig());
    // The default configuration is the one recorded in the workbook of every analysis so far.
    expect(await configHash(m.config.defaults())).toBe('c1b677af09cf086a84df99daabdaaf548759881385db6c2a908958796bf5a7a6');
    const read = m.config.read({ ...defaultConfig(), balanceToleranceCents: 5 });
    expect(read.ok && read.config.balanceToleranceCents).toBe(5);
  });

  it('offers the CT2 integrity module as a preview: reading, reconciliation and tests, with rules saved on this computer', () => {
    expect(getModule('ct2Integrity')).toBe(ct2IntegrityModule);
    const m = ct2IntegrityModule;
    expect(m).toMatchObject({ status: 'available', title: 'Integridade da CT2', helpAnchor: 'ct2' });
    expect(m.preview).toMatch(/^Prévia: /);
    expect(m.features).toEqual({ panel: false, tables: false, justifications: false, export: false });
    expect(m.config.saved).toBe(true);
    expect(m.config.defaults()).toEqual(ct2DefaultConfig());
    expect(m.progress.stages.map((s) => s.id)).toEqual(['fileCheck', 'sharedStrings', 'rows', 'reconciliation', 'sort', 'documents', 'checks']);
    expect(m.progress.perFile).toBe(3);
  });

  it('starts with the last module used only when it can be used', () => {
    expect(resolveInitialModule('cfgr700')).toBe('cfgr700');
    expect(resolveInitialModule('ct2Integrity')).toBe('ct2Integrity');
    for (const stored of [undefined, null, 'xyz', 'constructor', 42, {}]) {
      expect(resolveInitialModule(stored)).toBe('cfgr700');
    }
  });

  it('points every module to an existing section of the manual', () => {
    const help = readFileSync('public/ajuda.html', 'utf8');
    for (const m of MODULES.filter((d) => d.helpAnchor !== null)) expect(help, m.id).toContain(`id="${m.helpAnchor}"`);
  });

  it('keeps the descriptors free of React, so the worker can import them', () => {
    for (const file of files('src/modules').filter((f) => /module\.ts$|registry\.ts$|types\.ts$/.test(f))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from 'react'/);
    }
  });

  it('never compares module ids outside the module folders (docs/MODULOS.md, section 1)', () => {
    const allowed = [join('src', 'modules'), join('src', 'shared', 'modules'), join('src', 'worker', 'modules')];
    const offenders = files('src')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !allowed.some((dir) => f.startsWith(dir)))
      .filter((f) => /['"](cfgr700|ct2Integrity)['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
