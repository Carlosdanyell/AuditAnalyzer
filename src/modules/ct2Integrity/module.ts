/**
 * Integrity of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md): reads, reconciles and runs the tests (Phases 9 and
 * 10), exports the workpaper (Phase 11) and offers the panel and the tables (Phase 12). Out of preview since the check
 * with a real extraction on 30/10/2026.
 */
import { ct2DefaultConfig, readCt2Config, type Ct2IntegrityConfig } from '../../config/ct2IntegritySchema';
import { CT2_STAGES } from '../../shared/modules/ct2Integrity';
import type { Stage } from '../../shared/protocol';
import type { AvailableModule } from '../types';
import { findChartHeaderRow, findHeaderRow } from './header';

const LABELS: Record<(typeof CT2_STAGES)[number], string> = {
  fileCheck: 'Conferência do arquivo (SHA-256 e ZIP)',
  sharedStrings: 'Leitura das strings compartilhadas',
  rows: 'Leitura das linhas',
  reconciliation: 'Reconciliação de linhas',
  sort: 'Ordenação da base',
  documents: 'Aglutinação e testes',
  checks: 'Verificação dos invariantes',
};

export const ct2IntegrityModule: AvailableModule<Ct2IntegrityConfig> = {
  status: 'available',
  id: 'ct2Integrity',
  title: 'Integridade da CT2',
  shortTitle: 'CT2',
  description: 'Agrupa os lançamentos por documento, lote e dia e testa o balanceamento e a integridade.',
  input: 'Extração da CT2 · .xlsx ou XML · plano de contas opcional',
  icon: 'ledger',
  highlights: ['Débito = crédito por documento, lote e dia', 'Centro de custo e filial pelo plano de contas', 'Planilha amarrada por fórmulas'],
  accent: 'teal',
  brandSubtitle: 'Integridade da CT2 · Protheus',
  preview: null,
  start: {
    heading: 'Extração da CT2',
    headingDescription: 'Lançamentos contábeis exportados da tabela CT2 do Protheus',
    uploadTitle: 'Carregue as extrações da CT2',
    uploadDescription:
      'Uma ou mais extrações da tabela CT2, em .xlsx ou no XML gerado pelo Protheus (também dentro de um .zip). Com mais de um arquivo (por exemplo, meses seguidos), as linhas são unidas numa base só. Junte o plano de contas (CT1) à lista para os testes de centro de custo, item contábil e classe de valor (C1 a C5).',
    dropTitle: 'Arraste os arquivos da CT2 aqui',
    guide: [
      { title: 'Carregue', text: 'as extrações da CT2, com os títulos das colunas nas primeiras linhas da aba, e, se quiser, o plano de contas na mesma lista.' },
      { title: 'Confira', text: 'a integridade dos arquivos, a reconciliação de linhas e os valores ilegíveis.' },
      { title: 'Veja', text: 'os totais por tipo de saldo e moeda e as ocorrências de cada teste de balanceamento e de integridade.' },
    ],
  },
  progress: { stages: CT2_STAGES.map((id: Stage & keyof typeof LABELS) => ({ id, label: LABELS[id] })), perFile: 3 },
  // The worker enforces the same limit (src/worker/modules/ct2Integrity/ingest.ts).
  // The XML the system writes is read as it comes (docs/REGRAS_CT2_INTEGRIDADE.md, section 2.1), or inside a .zip.
  accepts: { extensions: ['.xlsx', '.xml', '.zip'], maxFiles: 255 },
  helpAnchor: 'ct2',
  features: { overview: true, analysis: true, justifications: false, export: true },
  config: { defaults: ct2DefaultConfig, read: readCt2Config, saved: true },
  // A sheet whose first rows hold every mandatory title (the reading rule of section 2), or the chart of accounts,
  // which is loaded with the extraction.
  detect(sheets, config) {
    if (sheets.length === 0) return 'maybe';
    return sheets.some((s) => {
      const found = findHeaderRow(s.rows, config);
      const chart = findChartHeaderRow(s.rows, config);
      return found.ok || found.reason === 'duplicate' || chart.ok || chart.reason === 'duplicate';
    })
      ? 'match'
      : 'no';
  },
};
