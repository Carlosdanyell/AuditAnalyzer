import { describe, expect, it } from 'vitest';
import type { Justification } from '../../src/shared/protocol';
import {
  buildJsonExport,
  findConflicts,
  justificationKey,
  mergeImport,
  parseJsonImport,
  sameText,
} from '../../src/shared/justifications';

const j = (documentKey: string, kind: Justification['kind'], text: string, extra: Partial<Justification> = {}): Justification => ({
  documentKey,
  kind,
  text,
  responsible: '',
  coverage: { files: ['agosto.xlsx'], lastEvent: 100 },
  updatedAt: 1,
  ...extra,
});

describe('justification texts', () => {
  it('compares ignoring spaces and line breaks', () => {
    expect(sameText('Estorno  de\nlançamento ', 'Estorno de lançamento')).toBe(true);
    expect(sameText('Estorno', 'Estorno parcial')).toBe(false);
  });

  it('keys are per kind and document', () => {
    expect(justificationKey('change', 'D1')).not.toBe(justificationKey('deletion', 'D1'));
  });
});

describe('JSON export and import', () => {
  it('round-trips justifications with responsible and coverage', () => {
    const items = [j('D2', 'deletion', 'Duplicado', { responsible: 'Fulano' }), j('D1', 'change', 'Ajuste de histórico')];
    const text = buildJsonExport(items, '2026-09-25 10:00:00');
    const parsed = parseJsonImport(text);
    expect(parsed.map((p) => [p.kind, p.documentKey, p.text, p.responsible, p.coverage])).toEqual([
      ['change', 'D1', 'Ajuste de histórico', '', { files: ['agosto.xlsx'], lastEvent: 100 }],
      ['deletion', 'D2', 'Duplicado', 'Fulano', { files: ['agosto.xlsx'], lastEvent: 100 }],
    ]);
  });

  it('accepts a plain list of {documentKey, kind, text} without coverage', () => {
    const parsed = parseJsonImport(JSON.stringify([{ documentKey: 'D1', kind: 'change', text: 'x' }]));
    expect(parsed).toEqual([{ documentKey: 'D1', kind: 'change', text: 'x', responsible: '', confirmed: false }]);
  });

  it('rejects anything else with a clear message', () => {
    expect(() => parseJsonImport('{"a":1}')).toThrow(/justificativas/);
    expect(() => parseJsonImport('não é json')).toThrow(/JSON/);
  });
});

describe('merging an import', () => {
  const existing = [j('D1', 'change', 'Texto atual'), j('D2', 'deletion', 'Mesmo  texto')];
  const imported = [
    { documentKey: 'D1', kind: 'change' as const, text: 'Texto importado', responsible: 'Ana', confirmed: false },
    { documentKey: 'D2', kind: 'deletion' as const, text: 'Mesmo texto', responsible: '', confirmed: false },
    { documentKey: 'D3', kind: 'deletion' as const, text: 'Novo', responsible: '', confirmed: true },
    { documentKey: 'D4', kind: 'change' as const, text: '   ', responsible: '', confirmed: false },
  ];
  const coverage = { files: ['agosto.xlsx'], lastEvent: 200 };
  const confirmedCoverage = { files: ['agosto.xlsx', 'setembro.xlsx'], lastEvent: 300 };

  it('lists real conflicts only (different text after normalizing spaces)', () => {
    expect(findConflicts(existing, imported).map((c) => [c.documentKey, c.existing, c.imported])).toEqual([
      ['D1', 'Texto atual', 'Texto importado'],
    ]);
  });

  it('keeps existing texts in conflicts unless replaced, adds new ones and skips empty ones', () => {
    const kept = mergeImport(existing, imported, { coverage, confirmedCoverage, replace: new Set(), now: 9 });
    expect(kept.summary).toEqual({ added: 1, replaced: 0, kept: 1, unchanged: 1, empty: 1 });
    expect(kept.items.find((x) => x.documentKey === 'D1')?.text).toBe('Texto atual');
    const d3 = kept.items.find((x) => x.documentKey === 'D3')!;
    expect(d3.coverage).toEqual(confirmedCoverage);
    expect(d3.updatedAt).toBe(9);

    const replaced = mergeImport(existing, imported, { coverage, confirmedCoverage, replace: 'all', now: 9 });
    expect(replaced.summary.replaced).toBe(1);
    expect(replaced.items.find((x) => x.documentKey === 'D1')).toMatchObject({ text: 'Texto importado', responsible: 'Ana', coverage });
  });
});
