/**
 * Plano de contas (docs/REGRAS_PLANO_DE_CONTAS.md): reads the CSV of the chart of accounts exported by the Protheus
 * (tables CT1 + CVD), validates it (E01–E07 block, A01–A09 warn) and generates the workbook "Doc-01-Plano de Contas",
 * with the hierarchy grouped by level. Runs with the versioned configuration (domains of the coded fields), without a
 * Configuração screen. In preview until the equivalence with the reference workbook is checked with the real file.
 */
import { chartDefaultConfig, readChartConfig, type ChartConfig } from '../../config/chartOfAccountsSchema';
import { CHART_STAGES } from '../../shared/modules/chartOfAccounts';
import type { Stage } from '../../shared/protocol';
import { isTableExport, tableExportHeader } from '../../shared/tableExport';
import type { AvailableModule } from '../types';

const LABELS: Record<(typeof CHART_STAGES)[number], string> = {
  fileCheck: 'Conferência do arquivo (SHA-256)',
  rows: 'Leitura do CSV (CT1 e CVD)',
  checks: 'Validação (E01–E07 e A01–A09)',
  transform: 'Transformação nas linhas da planilha',
};

export const chartOfAccountsModule: AvailableModule<ChartConfig> = {
  status: 'available',
  id: 'chartOfAccounts',
  title: 'Plano de contas',
  shortTitle: 'CT1',
  description: 'Valida o plano de contas do Protheus e gera a planilha com a hierarquia agrupada por nível.',
  input: 'Plano de contas CT1 + CVD · .csv',
  icon: 'accounts',
  highlights: ['Nível pela cadeia de contas superiores', 'Vínculo com o plano referencial (ECD)', 'Erro bloqueante impede a planilha'],
  accent: 'steel',
  brandSubtitle: 'Plano de contas · Protheus',
  preview:
    'Prévia: o módulo lê, valida e gera a planilha do plano de contas; falta conferir a planilha gerada com a planilha de referência a partir do arquivo real (teste de equivalência, seção 9.4 das regras).',
  start: {
    heading: 'Plano de contas (CT1 + CVD)',
    headingDescription: 'CSV do plano de contas exportado do Protheus',
    uploadTitle: 'Carregue o plano de contas',
    uploadDescription:
      'O CSV exportado do Protheus com as tabelas CT1 (plano de contas) e CVD (vínculo com o plano referencial do SPED ECD), separado por ponto e vírgula, em ANSI (windows-1252) ou UTF-8. Um arquivo por análise; o período (MM.AAAA) é informado na Exportação.',
    dropTitle: 'Arraste o CSV do plano de contas aqui',
    guide: [
      { title: 'Carregue', text: 'o CSV do plano de contas (CT1 + CVD), como o Protheus o exporta.' },
      { title: 'Confira', text: 'os totais, a distribuição por nível e por natureza SPED, os erros bloqueantes e os alertas, com a conta e a linha de cada um.' },
      { title: 'Gere', text: 'a planilha Doc-01-Plano de Contas, liberada só sem erro bloqueante, com o período no nome da aba e do arquivo.' },
    ],
  },
  progress: { stages: CHART_STAGES.map((id: Stage & keyof typeof LABELS) => ({ id, label: LABELS[id] })), perFile: 2 },
  // The worker refuses another extension and more than one file too (src/worker/modules/chartOfAccounts/ingest.ts).
  accepts: { extensions: ['.csv'], maxFiles: 1 },
  helpAnchor: 'chartOfAccounts',
  features: { panel: false, findings: false, tables: false, justifications: false, export: true },
  config: { defaults: chartDefaultConfig, read: readChartConfig, saved: false },
  // The probe reads a delimited export of the system as text (src/worker/ingest/probe.ts): it is this file when the
  // CT1 is among its tables.
  detect(sheets) {
    if (sheets.length === 0) return 'maybe';
    return sheets.some((s) => {
      const lines = s.rows.map((r) => r.titles[0] ?? '');
      return s.format === 'text' && isTableExport(lines) && (lines.some((l) => tableExportHeader(l) === 'CT1') || /^0;(.*;)?CT1(;|\s*$)/.test(lines[0]!.trim()));
    })
      ? 'match'
      : 'no';
  },
};
