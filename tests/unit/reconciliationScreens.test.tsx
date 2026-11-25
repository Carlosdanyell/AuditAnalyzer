/**
 * Screens of the Conciliador after the analysis (Phase 15, step 5; section 9 of docs/REGRAS_CONCILIADOR.md): the
 * Reconciliação de leitura, the Painel, Achados, the side panel of an account, Justificativas, the key figures and the
 * rail, rendered as static markup over a synthetic session (tests/synthetic/reconciliationSession.ts), and the pure
 * helpers (board of invariants, blocks of findings, chip of the table, stored justifications).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { railViews } from '../../src/app/rail';
import { reconciliationFigures } from '../../src/app/modules/reconciliation/figures';
import { ConcAccountDetailView, accountTitle } from '../../src/app/modules/reconciliation/ConcAccountPanel';
import { ConcFindingsView, findingBlocks } from '../../src/app/modules/reconciliation/ConcFindingsView';
import { ConcJustificationsView } from '../../src/app/modules/reconciliation/ConcJustificationsView';
import { ConcPanelView } from '../../src/app/modules/reconciliation/ConcPanelView';
import { ConcReconciliationView, invariantBoard } from '../../src/app/modules/reconciliation/ConcReconciliationView';
import { concExportContent, concExportJustifications, concFilterText } from '../../src/app/modules/reconciliation/ReconciliationWorkspace';
import { readStoredJustifications, reconciliationJustificationKey, storedJustifications, type ReconciliationJustification } from '../../src/app/reconciliationJustificationStore';
import { reconciliationModule } from '../../src/modules/reconciliation/module';
import type { AvailableModule } from '../../src/modules/types';
import type { ReconciliationAccountDetail, ReconciliationReconciliation, ReconciliationSummary } from '../../src/shared/modules/reconciliation';
import { reconciliationWorker } from '../../src/worker/modules/reconciliation';
import type { ModuleSession } from '../../src/worker/modules/types';
import { configOf, profileWithStatuses, screenFixture, sessionFiles } from '../synthetic/reconciliationSession';

const E2E_WORDS = /analisar|ajuda|configuração|painel|cancelar|nova análise|exportar planilha/i;

async function session(statuses = false) {
  const { fx, real, preEntry } = screenFixture();
  const profile = statuses ? profileWithStatuses(fx.profile) : fx.profile;
  const ingest = reconciliationWorker.configure(configOf(profile), null);
  const files = sessionFiles(fx, [
    { format: 'text', fixture: real },
    { format: 'xml', fixture: preEntry },
  ]).map((f) => ({ name: f.name, blob: new Blob([f.bytes as Uint8Array<ArrayBuffer>]) }));
  const result = await ingest(files, () => {}, { progressIntervalMs: 0 });
  return {
    reconciliation: result.reconciliation as ReconciliationReconciliation,
    summary: result.summary as ReconciliationSummary,
    account: (i: number) => (result.session as Required<Pick<ModuleSession, 'account'>>).account(i) as ReconciliationAccountDetail,
  };
}

/** The accessible names of the buttons of a markup. */
const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)].map((m) => /aria-label="([^"]*)"/.exec(m[1]!)?.[1] ?? m[2]!.replace(/<[^>]+>/g, '').trim());
const noop = () => {};

describe('Reconciliação de leitura', () => {
  it('shows each file side by side, with report, format, SHA-256 and the board of invariants', async () => {
    const { reconciliation, summary } = await session();
    const html = renderToStaticMarkup(<ConcReconciliationView data={reconciliation} summary={summary} preview={reconciliationModule.preview} />);
    expect(html).toContain('Prévia: o Conciliador');
    expect(html).toContain('Folha de pagamento (GPER040)');
    expect(html).toContain('Razão analítico (CTBR400)');
    expect(html).toContain('Quadro de invariantes');
    for (const f of reconciliation.files) expect(html).toContain(f.sha256);
    expect(html).toContain('GPER040 · TXT do spool');
    expect(html).toContain('CTBR400 · XML (SpreadsheetML)');
    expect(html).toContain('Pré-lançamento (9)');
    expect(html).toContain('Integridade confirmada');
    for (const b of buttons(html)) expect(b).not.toMatch(E2E_WORDS);
  });

  it('groups the checks by family: L, R and V, T, CC', async () => {
    const { reconciliation } = await session();
    expect(invariantBoard(reconciliation.checks).map((f) => [f.id, f.checks.map((c) => c.id)])).toEqual([
      ['L', ['L-1', 'L-2', 'L-3', 'L-4', 'L-5', 'L-6', 'L-7']],
      ['R', ['R-1', 'R-2', 'R-3', 'R-4', 'R-5', 'R-6', 'R-9', 'R-7', 'R-8', 'V-3']],
      ['T', ['T1', 'T3']],
      ['CC', ['F2', 'CC-1', 'CC-2', 'CC-3', 'CC-4']],
    ]);
  });
});

describe('Painel and Achados', () => {
  it('one row per account; each number is a button that names the account', async () => {
    const { summary } = await session();
    const html = renderToStaticMarkup(<ConcPanelView summary={summary} onOpenTable={noop} onOpenAccount={noop} />);
    const names = buttons(html);
    for (const a of summary.accounts) {
      expect(html).toContain(a.tickMark);
      expect(names).toContain(`Abrir a conta ${a.account}`);
      expect(names.some((n) => n.startsWith(`Esperado da conta ${a.account}: `))).toBe(true);
      expect(names.some((n) => n.startsWith(`Saldo contábil da conta ${a.account}: `))).toBe(true);
      expect(names.some((n) => n.startsWith(`Diferença da conta ${a.account}: `))).toBe(true);
    }
    expect(html).toContain('Sem diferença — conferir alertas');
    expect(html).toContain('Com diferença — composição identificada');
    expect(html).toContain('Saldo pré-lançamento (9)');
    for (const b of names) expect(b).not.toMatch(E2E_WORDS);
  });

  it('Achados: Erro, Alerta and Informativo, a block per code, the F1c with its account', async () => {
    const { summary } = await session();
    const html = renderToStaticMarkup(<ConcFindingsView summary={summary} onOpenTable={noop} onOpenAccount={noop} />);
    expect(html).toMatch(/Erro · 0 ocorrência/);
    expect(html).toContain('Nenhum erro de integração.');
    expect(html).toContain('F1c</code> Verba da folha sem integração na conta');
    expect(html).toContain('F2</code> Diferença entre o esperado e o saldo contábil');
    expect(buttons(html)).toContain('Ver todas as ocorrências de F1c');
    expect(findingBlocks(summary.findings, 'warning').map((b) => b.code)).toEqual(expect.arrayContaining(['F1c', 'F2']));
    expect(findingBlocks(summary.findings, 'info').map((b) => b.code)).toContain('T2');
    for (const b of buttons(html)) expect(b).not.toMatch(E2E_WORDS);
  });

  it('a chip names the filter that opened a table', async () => {
    const { summary } = await session();
    expect(concFilterText({ account: 1, settled: true }, summary)).toBe('conta 9.9.1.0.10.02 · baixa do saldo anterior');
    expect(concFilterText({ code: 'F1c' }, summary)).toBe('F1c · Verba da folha sem integração na conta');
    expect(concFilterText({}, summary)).toBe('');
  });
});

describe('side panel of an account', () => {
  it('criterion, the bridge that closes with its parcels, the settlement and the text with a copy button', async () => {
    const { account } = await session();
    const d = account(1);
    const html = renderToStaticMarkup(<ConcAccountDetailView detail={d} titleId="t" onCopy={noop} copied={false} />);
    expect(accountTitle(d.row)).toBe(`Conta ${d.row.account} · ${d.row.name}`);
    expect(html).toContain('A ponte fecha');
    for (const p of d.bridge!.parcels) expect(html).toContain(p.label);
    expect(html).toContain('Baixa do saldo anterior (F3): Identificada');
    expect(html).toContain('Lançamentos da baixa');
    expect(html).toContain('Texto do critério');
    expect(html).toContain('Fizemos a comparação do saldo da conta');
    expect(buttons(html)).toContain('Copiar o texto do critério');
  });
});

describe('Justificativas', () => {
  it('free text per account; the list of the workpaper situations only with workpaperStatuses; the suggestion read-only', async () => {
    const plain = await session();
    const without = renderToStaticMarkup(<ConcJustificationsView summary={plain.summary} justifications={new Map()} loaded onSave={async () => true} onOpenAccount={noop} />);
    expect(without).toContain('Justificativa da conta 9.9.1.0.10.01');
    expect(without).not.toContain('Situação no papel de trabalho');
    expect(without).toContain('Situação sugerida pelo módulo');

    const { summary } = await session(true);
    const saved: ReconciliationJustification = { period: summary.period, account: '9.9.1.0.10.01', text: 'Verba lançada à mão, conferida.', status: 'Conciliado', updatedAt: 1 };
    const map = new Map([[reconciliationJustificationKey(saved.period, saved.account), saved]]);
    const html = renderToStaticMarkup(<ConcJustificationsView summary={summary} justifications={map} loaded onSave={async () => true} onOpenAccount={noop} />);
    expect(html).toContain('Situação no papel de trabalho da conta 9.9.1.0.10.01');
    expect(html).toContain('Verba lançada à mão, conferida.');
    expect(html).toMatch(/<option value="Conciliado" selected="">Conciliado<\/option>/);
    // The module never chooses: the other accounts start with no situation.
    expect((html.match(/<option value="" selected="">/g) ?? []).length).toBe(summary.accounts.length - 1);
    for (const b of buttons(html)) expect(b).not.toMatch(E2E_WORDS);
  });

  it('stored value: versioned, keyed by competence and account, malformed items ignored', () => {
    const a: ReconciliationJustification = { period: '202610', account: '9.9.1.0.10.02', text: 'x', status: null, updatedAt: 2 };
    const b: ReconciliationJustification = { period: '202610', account: '9.9.1.0.10.01', text: 'y', status: 'Pendente', updatedAt: 3 };
    const stored = storedJustifications(new Map([[reconciliationJustificationKey(a.period, a.account), a], [reconciliationJustificationKey(b.period, b.account), b]]));
    expect(Object.keys(stored.items)).toEqual(['202610|9.9.1.0.10.01', '202610|9.9.1.0.10.02']);
    expect([...readStoredJustifications(stored).values()]).toEqual([b, a]);
    expect(readStoredJustifications({ schemaVersion: 2, items: stored.items }).size).toBe(0);
    expect(readStoredJustifications({ schemaVersion: 1, items: { 'x|y': a, ...stored.items, bad: { text: 1 } } }).size).toBe(2);
    expect(readStoredJustifications(undefined).size).toBe(0);
  });
});

describe('rail and key figures', () => {
  it('every view of the platform; seven key figures', async () => {
    expect(railViews(reconciliationModule as unknown as AvailableModule).map((v) => v.id)).toEqual(['reconciliation', 'panel', 'findings', 'tables', 'justifications', 'export']);
    const { reconciliation, summary } = await session();
    const figures = reconciliationFigures(reconciliation, summary, 0);
    expect(figures.map((f) => [f.label, f.value])).toEqual([
      ['Contas', '3'],
      ['Sem diferença', '2'],
      ['Com diferença', '1'],
      ['Erros de integração', '0'],
      ['Verbas sem integração (F1c)', '1'],
      ['Linhas de integração conferidas', String(summary.figures.checkedLines)],
      ['Competência', '10/2026'],
    ]);
  });
});

describe('Exportação', () => {
  it('sends the justifications of the competence of the session, in the order of the profile, and none of another month', async () => {
    const { summary } = await session();
    const [net, verbas] = summary.accounts;
    const item = (period: string, account: string, text: string, status: string | null): [string, ReconciliationJustification] => [reconciliationJustificationKey(period, account), { period, account, text, status, updatedAt: 1 }];
    const stored = new Map([item(summary.period, verbas!.account, 'B', 'Conciliado'), item('202609', net!.account, 'outro mês', null), item(summary.period, net!.account, 'A', null), item(summary.period, 'fora', 'x', null)]);
    expect(concExportJustifications(summary, stored)).toEqual([
      { account: net!.account, text: 'A', status: null },
      { account: verbas!.account, text: 'B', status: 'Conciliado' },
    ]);
    expect(concExportJustifications(summary, new Map([item(summary.period, net!.account, '  ', null)]))).toEqual([]);
  });

  it('names the tabs of section 10 and no word the e2e tests look for', () => {
    const content = concExportContent(0, () => {});
    expect(content.tabs).toEqual(['Resumo', 'Criterios', 'Folha_Escopo', 'Folha_Filial', 'Integracao', 'Razao', 'Ponte']);
    const html = renderToStaticMarkup(<ul>{content.facts}</ul>);
    expect(html).toContain('Escrever justificativas');
    expect(html).not.toMatch(E2E_WORDS);
    expect(renderToStaticMarkup(<ul>{concExportContent(2, () => {}).facts}</ul>)).not.toContain('Escrever justificativas');
  });
});
