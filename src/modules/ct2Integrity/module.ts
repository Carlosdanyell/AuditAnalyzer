/**
 * Integrity of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md): a preview that reads, reconciles and runs the
 * tests (Phases 9 and 10); the panel, the tables and the spreadsheet come in Phases 11 and 12.
 */
import { ct2DefaultConfig, readCt2Config, type Ct2IntegrityConfig } from '../../config/ct2IntegritySchema';
import { CT2_STAGES } from '../../shared/modules/ct2Integrity';
import type { Stage } from '../../shared/protocol';
import type { AvailableModule } from '../types';
import { findHeaderRow } from './header';

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
  description: 'Aglutinação dos lançamentos por documento, lote e dia, testes de balanceamento e de integridade, planilha amarrada por fórmulas.',
  input: 'Extração da tabela CT2 (lançamentos), em .xlsx',
  brandSubtitle: 'Integridade da CT2 · Protheus',
  preview:
    'Prévia: esta versão lê a extração da CT2, reconcilia as linhas e aplica os testes de balanceamento e de integridade (quadro de testes). O painel, as tabelas e a planilha chegam nas próximas versões.',
  start: {
    heading: 'Extração da CT2',
    headingDescription: 'Lançamentos contábeis exportados da tabela CT2 do Protheus',
    uploadTitle: 'Carregue as extrações da CT2',
    uploadDescription: 'Uma ou mais extrações da tabela CT2, em .xlsx. Com mais de um arquivo (por exemplo, meses seguidos), as linhas são unidas numa base só.',
    dropTitle: 'Arraste os arquivos da CT2 aqui',
    guide: [
      { title: 'Carregue', text: 'as extrações da CT2, com os títulos das colunas nas primeiras linhas da aba.' },
      { title: 'Confira', text: 'a integridade dos arquivos, a reconciliação de linhas e os valores ilegíveis.' },
      { title: 'Veja', text: 'os totais por tipo de saldo e moeda e as ocorrências de cada teste de balanceamento e de integridade.' },
    ],
  },
  progress: { stages: CT2_STAGES.map((id: Stage & keyof typeof LABELS) => ({ id, label: LABELS[id] })), perFile: 3 },
  // The worker enforces the same limit (src/worker/modules/ct2Integrity/ingest.ts).
  accepts: { extensions: ['.xlsx'], maxFiles: 255 },
  helpAnchor: 'ct2',
  features: { panel: false, tables: false, justifications: false, export: false },
  config: { defaults: ct2DefaultConfig, read: readCt2Config, saved: true },
  // A sheet whose first rows hold every mandatory title (the reading rule of section 2).
  detect(sheets, config) {
    if (sheets.length === 0) return 'maybe';
    return sheets.some((s) => {
      const found = findHeaderRow(s.rows, config);
      return found.ok || found.reason === 'duplicate';
    })
      ? 'match'
      : 'no';
  },
};
