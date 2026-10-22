/** Audit log analysis of the CFGR700 report (docs/REGRAS_CFGR700.md). */
import { defaultConfig, type AnalyzerConfig } from '../../config/schema';
import { readConfig } from '../../shared/configTools';
import { PIPELINE_STAGES, type PipelineStage } from '../../shared/protocol';
import type { AvailableModule, ProgressSteps } from '../types';

const LABELS: Record<PipelineStage, string> = {
  fileCheck: 'Conferência do arquivo (SHA-256 e ZIP)',
  parameters: 'Leitura dos parâmetros',
  sharedStrings: 'Leitura das strings compartilhadas',
  rows: 'Leitura das linhas',
  reconciliation: 'Reconciliação de linhas',
  events: 'Montagem de eventos',
  documents: 'Registros, documentos e classificação',
  checks: 'Verificação dos invariantes',
};

/** The stages of the CFGR700 analysis. */
export const CFGR700_STEPS: ProgressSteps = { stages: PIPELINE_STAGES.map((id) => ({ id, label: LABELS[id] })), perFile: 4 };

export const cfgr700Module: AvailableModule<AnalyzerConfig> = {
  status: 'available',
  id: 'cfgr700',
  title: 'Log de auditoria (CFGR700)',
  shortTitle: 'CFGR700',
  description: 'Exclusões, alterações, desbalanceamentos e postagens dos lançamentos contábeis, por período e origem.',
  input: 'Relatório CFGR700 do Protheus (tabela CT2), em .xlsx',
  brandSubtitle: 'CFGR700 · Protheus',
  preview: null,
  start: {
    heading: 'Arquivos do log',
    headingDescription: 'Relatório de log de auditoria CFGR700 do Protheus',
    uploadTitle: 'Carregue as extrações do CFGR700',
    uploadDescription: 'Uma ou mais extrações do relatório, em .xlsx. Com mais de um arquivo, a ordem da lista define a ordem das fontes.',
    dropTitle: 'Arraste os arquivos do CFGR700 aqui',
    guide: [
      { title: 'Carregue', text: 'as extrações do CFGR700, na ordem das fontes.' },
      { title: 'Confira', text: 'a integridade, a reconciliação de linhas e as verificações.' },
      { title: 'Analise e justifique', text: 'exclusões, alterações e desbalanceamentos por período e origem.' },
      { title: 'Exporte', text: 'o papel de trabalho em Excel, com rastreabilidade.' },
    ],
  },
  progress: CFGR700_STEPS,
  // The worker enforces the same limit (src/worker/ingest/pipeline.ts).
  accepts: { extensions: ['.xlsx'], maxFiles: 255 },
  helpAnchor: 'cfgr700',
  features: { panel: true, tables: true, justifications: true, export: true },
  config: { defaults: defaultConfig, read: readConfig, saved: true },
  // The report sheet starts with the configured column titles in row 1 (src/worker/ingest/pipeline.ts).
  detect(sheets, config) {
    if (sheets.length === 0) return 'maybe';
    const titles = Object.values(config.columns);
    const header = (row: { r: number; titles: string[] }) => row.r === 1 && titles.every((t) => row.titles.some((x) => x.trim() === t));
    return sheets.some((s) => s.rows.some(header)) ? 'match' : 'no';
  },
};
