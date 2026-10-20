/** Audit log analysis of the CFGR700 report (docs/REGRAS_CFGR700.md). */
import { defaultConfig, type AnalyzerConfig } from '../../config/schema';
import { readConfig } from '../../shared/configTools';
import type { AvailableModule } from '../types';

export const cfgr700Module: AvailableModule<AnalyzerConfig> = {
  status: 'available',
  id: 'cfgr700',
  title: 'Log de auditoria (CFGR700)',
  shortTitle: 'CFGR700',
  description: 'Exclusões, alterações, desbalanceamentos e postagens dos lançamentos contábeis, por período e origem.',
  input: 'Relatório CFGR700 do Protheus (tabela CT2), em .xlsx',
  brandSubtitle: 'CFGR700 · Protheus',
  start: {
    heading: 'Arquivos do log',
    headingDescription: 'Relatório de log de auditoria CFGR700 do Protheus',
    uploadTitle: 'Carregue as extrações do CFGR700',
    uploadDescription: 'Uma ou mais extrações do relatório, em .xlsx. Com mais de um arquivo, a ordem da lista define a ordem das fontes.',
    dropTitle: 'Arraste os arquivos do CFGR700 aqui',
  },
  // The worker enforces the same limit (src/worker/ingest/pipeline.ts).
  accepts: { extensions: ['.xlsx'], maxFiles: 255 },
  helpAnchor: 'cfgr700',
  features: { justifications: true },
  config: { defaults: defaultConfig, read: readConfig },
};
