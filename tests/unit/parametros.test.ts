import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/schema';
import { parseDateTime } from '../../src/shared/dates';
import { checkParameters, parseParameterRows } from '../../src/worker/ingest/parametros';

const ROWS: string[][] = [
  ['Dt.Ref: 01/01/2030'],
  ['Hora: 12:00:00'],
  ['Emissão: 01/01/2030'],
  ['Pergunta 01 : Tabela início ?', 'CT2'],
  ['Pergunta 02 : Tabela fim ?', 'CT2'],
  ['Pergunta 03 : Campo ?', ''],
  ['Pergunta 06 : Data inicial ?', '01/09/2026'],
  ['Pergunta 07 : Data final ?', '04/09/2026'],
  ['Pergunta 08 : Operação de inclusão ?', 'Sim'],
  ['Pergunta 09 : Operação de alteração ?', 'Sim'],
  ['Pergunta 10 : Operação de exclusão ?', 'Sim'],
  ['Pergunta 13 : Operação de Recuperação ?', 'Sim'],
  ['Pergunta 14 : Exclui campos não alterados ?', 'Sim'],
];

const first = parseDateTime('01/09/2026 08:00:00');
const last = parseDateTime('04/09/2026 17:00:00');

describe('parameters sheet', () => {
  it('reads header lines and numbered questions', () => {
    const pairs = parseParameterRows(ROWS);
    expect(pairs[0]).toEqual({ question: null, label: 'Dt.Ref', value: '01/01/2030' });
    expect(pairs[1]).toEqual({ question: null, label: 'Hora', value: '12:00:00' });
    expect(pairs[3]).toEqual({ question: 1, label: 'Tabela início', value: 'CT2' });
    expect(pairs[5]).toEqual({ question: 3, label: 'Campo', value: '' });
    expect(pairs).toHaveLength(ROWS.length);
  });

  it('raises no alert for a report extracted as the rules assume', () => {
    expect(checkParameters(parseParameterRows(ROWS), defaultConfig(), first, last)).toEqual([]);
  });

  it('alerts on another table, a disabled operation and "Exclui campos não alterados" ≠ Sim', () => {
    const rows = ROWS.map((r) =>
      r[0]!.includes('Tabela fim') ? [r[0]!, 'SE2'] : r[0]!.includes('exclusão') || r[0]!.includes('Exclui') ? [r[0]!, 'Não'] : r,
    );
    const alerts = checkParameters(parseParameterRows(rows), defaultConfig(), first, last).map((a) => a.message);
    expect(alerts).toEqual([
      'Parâmetro "Tabela fim" = "SE2"; a configuração é para a tabela CT2.',
      'Parâmetro "Operação de exclusão" = "Não"; o esperado é "Sim".',
      'Parâmetro "Exclui campos não alterados" = "Não"; o esperado é "Sim".',
    ]);
  });

  it('alerts when a question is missing or events fall outside the requested dates', () => {
    const rows = ROWS.filter((r) => !r[0]!.includes('Recuperação'));
    const alerts = checkParameters(
      parseParameterRows(rows),
      defaultConfig(),
      parseDateTime('31/08/2026 23:59:59'),
      parseDateTime('05/09/2026 00:00:00'),
    ).map((a) => a.message);
    expect(alerts).toEqual([
      'Parâmetro "Operação de Recuperação" não encontrado na aba de parâmetros.',
      'Primeiro evento (31/08/2026 23:59:59) anterior à data inicial do relatório (01/09/2026).',
      'Último evento (05/09/2026 00:00:00) posterior à data final do relatório (04/09/2026).',
    ]);
  });

  it('matches question labels ignoring accents and case', () => {
    const rows = ROWS.map((r) => (r[0]!.includes('Tabela início') ? ['Pergunta 01 : TABELA INICIO ?', 'CT2'] : r));
    expect(checkParameters(parseParameterRows(rows), defaultConfig(), first, last)).toEqual([]);
  });
});
