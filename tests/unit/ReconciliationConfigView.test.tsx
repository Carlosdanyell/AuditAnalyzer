import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readPayrollProfileFile, reconciliationDefaultConfig, withPayrollProfile } from '../../src/config/reconciliationSchema';
import { configViewOf } from '../../src/app/moduleViews';
import { ReconciliationConfigView } from '../../src/app/views/ReconciliationConfigView';
import { reconciliationModule } from '../../src/modules/reconciliation/module';
import { payrollProfileFile, provisionProfileFile } from '../synthetic/reconciliationProfile';

/** Configuração screen of the Conciliador (docs/REGRAS_CONCILIADOR.md, section 6). */
const props = {
  onSave: async () => true,
  holidays: [],
  analysisLoaded: false,
  needsReprocess: false,
  canReprocess: false,
  onReprocess: () => {},
  onClose: () => {},
};

describe('Conciliador configuration screen', () => {
  it('is the configuration screen of the module, found by its descriptor', () => {
    expect(configViewOf(reconciliationModule)).toBe(ReconciliationConfigView);
  });

  it('without accounts: says the profile is missing, offers to build it, import it, export it and download the template', () => {
    const html = renderToStaticMarkup(<ReconciliationConfigView config={reconciliationDefaultConfig()} {...props} />);
    expect(html).toContain('Perfil sem contas: monte o perfil abaixo ou importe o arquivo JSON para analisar.');
    expect(html).toContain('Importar perfil (JSON)');
    expect(html).toContain('Exportar perfil (JSON)');
    expect(html).toContain('Baixar modelo do perfil');
    expect(html).toMatch(/<input[^>]*accept=".json,application\/json"[^>]*aria-label="Arquivo do perfil de contas \(JSON\)"/);
    expect(html).toContain('Nenhuma conta no perfil.');
    expect(html).toContain('Adicionar conta');
    expect(html).toContain('Modo da nova conta');
    // The general sections of the profile, with plain labels.
    for (const text of [
      'Folha (GPER040)',
      'Nível do escopo',
      'Tipo de contrato',
      'Verba do líquido da folha',
      'Razão (CTBR400)',
      'Classes de lote',
      'Verba no histórico',
      'Relatórios de provisão (GPER070 e GPER090)',
      'Incluir os relatórios de provisão',
      'Máximo de lançamentos pesquisados',
      'Situações do papel de trabalho',
    ]) {
      expect(html).toContain(text);
    }
    // No button of the screen takes a name the end-to-end tests look for by substring (docs/INTERFACE.md).
    const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => `${m[1]!.replace(/<[^>]+>/g, ' ')} ${/aria-label="([^"]*)"/.exec(m[0])?.[1] ?? ''}`.toLowerCase());
    for (const name of ['analisar', 'ajuda', 'painel', 'cancelar', 'nova análise', 'exportar planilha']) expect(buttons.filter((b) => b.includes(name))).toEqual([]);
  });

  it('with a profile: one card per account with its tick mark, pattern, side and criterion, and its actions named by the account', () => {
    const read = readPayrollProfileFile(payrollProfileFile());
    if (!read.ok) throw new Error('invalid');
    const html = renderToStaticMarkup(<ReconciliationConfigView config={withPayrollProfile(reconciliationDefaultConfig(), read.profile)} {...props} />);
    expect(html).toContain('Perfil com 3 conta(s).');
    expect(html).toContain('Contas do perfil (3)');
    expect(html).toContain('verba do líquido X99');
    expect(html).toContain('B20, 7AB');
    expect(html).toContain('A10; baixa: C31');
    expect(html).toContain('Credora');
    expect(html).toContain('Devedora');
    expect(html).toContain('aria-label="Editar a conta 9.9.1.0.10.01"');
    expect(html).toContain('aria-label="Duplicar a conta 9.9.1.0.10.02"');
    expect(html).toContain('aria-label="Remover a conta 9.9.1.0.20.01"');
    expect(html).toContain('aria-expanded="false"');
    // Batch classes as rows, each field with its own name.
    expect(html).toContain('aria-label="Começo da chave do lote 1"');
    expect(html).toContain('value="000777"');
  });

  it('with the provision reports: the reversal marker, the end text and the 8 columns of each report; a missing end text is a warning by field', () => {
    const file = provisionProfileFile();
    delete file.provisionReports!.endMarker;
    const read = readPayrollProfileFile(file);
    if (!read.ok) throw new Error('invalid');
    const html = renderToStaticMarkup(<ReconciliationConfigView config={withPayrollProfile(reconciliationDefaultConfig(), read.profile)} {...props} />);
    expect(html).toContain('Marcador de estorno');
    expect(html).toContain('value=" NEG "');
    expect(html).toContain('Texto de fim dos relatórios');
    expect(html).toContain('Colunas do GPER070 (férias)');
    expect(html).toContain('TOTAL FERIAS');
    expect(html).toContain('Relatórios de provisão › Texto de fim dos relatórios:');
    expect(html).toContain('Informe o texto de fim dos relatórios de provisão');
    // Removing the reports waits for the provision accounts to go.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Retirar os relatórios de provisão/);
  });
});
