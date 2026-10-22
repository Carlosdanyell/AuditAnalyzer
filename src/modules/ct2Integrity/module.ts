/** Integrity of the CT2 extraction (docs/REGRAS_CT2_INTEGRIDADE.md): a preview that reads and reconciles (Phase 9). */
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
    'Prévia: esta versão lê a extração da CT2, confere a integridade dos arquivos e reconcilia as linhas. Os testes, o painel, as tabelas e a planilha chegam nas próximas versões.',
  start: {
    heading: 'Extração da CT2',
    headingDescription: 'Lançamentos contábeis exportados da tabela CT2 do Protheus',
    uploadTitle: 'Carregue as extrações da CT2',
    uploadDescription: 'Uma ou mais extrações da tabela CT2, em .xlsx. Com mais de um arquivo (por exemplo, meses seguidos), as linhas são unidas numa base só.',
    dropTitle: 'Arraste os arquivos da CT2 aqui',
    guide: [
      { title: 'Carregue', text: 'as extrações da CT2, com os títulos das colunas nas primeiras linhas da aba.' },
      { title: 'Confira', text: 'a integridade dos arquivos, a reconciliação de linhas e os valores ilegíveis.' },
      { title: 'Veja', text: 'as linhas, os documentos e os totais de débito e crédito por tipo de saldo e moeda.' },
    ],
  },
  progress: { stages: CT2_STAGES.map((id: Stage & keyof typeof LABELS) => ({ id, label: LABELS[id] })), perFile: 3 },
  // The worker enforces the same limit (src/worker/modules/ct2Integrity/ingest.ts).
  accepts: { extensions: ['.xlsx'], maxFiles: 255 },
  helpAnchor: 'ct2',
  features: { panel: false, tables: false, justifications: false, export: false },
  config: { defaults: ct2DefaultConfig, read: readCt2Config, saved: false },
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
