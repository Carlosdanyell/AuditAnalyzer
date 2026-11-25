/**
 * Conciliador (docs/REGRAS_CONCILIADOR.md): confronts the reports of origin (payroll today) with the ledger and exports
 * the workpaper tied out by formulas. In preview while Phase 15 is built: the reading, the analysis, the screens (steps 1
 * to 5) and the workpaper (step 6) are there; the provisions come with Phase 16.
 */
import { readReconciliationConfig, reconciliationDefaultConfig, reconciliationNotReady, type ReconciliationConfig } from '../../config/reconciliationSchema';
import { RECONCILIATION_STAGES } from '../../shared/modules/reconciliation';
import type { Stage } from '../../shared/protocol';
import type { AvailableModule } from '../types';
import { identifyReconciliationInput } from './detect';

const LABELS: Record<(typeof RECONCILIATION_STAGES)[number], string> = {
  fileCheck: 'Conferência do arquivo (SHA-256)',
  rows: 'Leitura dos relatórios',
  reconciliation: 'Reconciliação de leitura',
  checks: 'Verificação dos invariantes',
};

export const reconciliationModule: AvailableModule<ReconciliationConfig> = {
  status: 'available',
  id: 'reconciliation',
  title: 'Conciliador',
  shortTitle: 'CONC',
  description: 'Confronta a folha com o razão, conta a conta, e explica cada diferença.',
  input: 'Folha GPER040 e razão CTBR400 · TXT ou XML',
  icon: 'reconcile',
  highlights: ['Esperado de cada conta pela folha', 'Integração conferida por verba e filial', 'Diferença sinalizada a partir de R$ 0,01'],
  accent: 'ochre',
  brandSubtitle: 'Conciliador · Protheus',
  preview:
    'Prévia: o Conciliador está em construção. Já lê a folha (GPER040) e o razão (CTBR400) em TXT ou XML, reconcilia a leitura, concilia as contas do perfil com a ponte de cada uma, guarda as justificativas e exporta o papel de trabalho amarrado por fórmulas; as contas de provisão chegam na Fase 16.',
  start: {
    heading: 'Relatórios da conciliação',
    headingDescription: 'Relatórios de origem e razão analítico exportados do Protheus',
    uploadTitle: 'Carregue os relatórios da conciliação',
    uploadDescription:
      'A folha de pagamento (GPER040) no TXT do spool e o razão analítico (CTBR400) das contas do perfil, no TXT do spool ou em XML. O arquivo é reconhecido pelo conteúdo, qualquer que seja a extensão (o spool vem como .##r ou .__r).',
    dropTitle: 'Arraste os relatórios aqui',
    guide: [
      { title: 'Importe', text: 'o perfil de contas (JSON) na Configuração: contas, verbas e regras do razão.' },
      { title: 'Carregue', text: 'a folha do mês e o razão das contas, como o Protheus os exporta.' },
      { title: 'Confira', text: 'a leitura de cada relatório e, por conta, o esperado, o saldo contábil e a composição da diferença.' },
    ],
  },
  progress: { stages: RECONCILIATION_STAGES.map((id: Stage & keyof typeof LABELS) => ({ id, label: LABELS[id] })), perFile: 2 },
  // The spool has no fixed extension: any file is listed and recognized by its content (section 3.2).
  accepts: { extensions: 'any', hint: 'TXT do spool, PDF, XML ou XLSX exportados do Protheus', maxFiles: 255 },
  helpAnchor: 'reconciliation',
  features: { panel: true, findings: true, tables: true, justifications: true, export: true },
  config: { defaults: reconciliationDefaultConfig, read: readReconciliationConfig, saved: true },
  notReady: reconciliationNotReady,
  detect(sheets, config) {
    if (sheets.length === 0) return 'maybe';
    return identifyReconciliationInput(sheets, config) ? 'match' : 'no';
  },
};
