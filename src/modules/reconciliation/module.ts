/**
 * Conciliador (docs/REGRAS_CONCILIADOR.md): confronts the reports of origin (payroll today) with the ledger and exports
 * the workpaper tied out by formulas. In preview while Phase 15 is built: step 1 has the descriptor, the profile on the
 * Configuração screen and the identification of the files; the reading comes with steps 2 to 4.
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
  description: 'Confronta os relatórios de origem com o razão contábil, conta a conta, e explica cada diferença pela movimentação da conta.',
  input: 'Folha de pagamento (GPER040) e razão analítico (CTBR400) do Protheus, no TXT do spool ou, o razão, em XML; perfil de contas importado na Configuração',
  icon: 'reconcile',
  highlights: [
    'Esperado de cada conta calculado pela folha, verba a verba',
    'Integração conferida por verba e filial com o razão',
    'Qualquer diferença sinalizada, a partir de R$ 0,01',
  ],
  brandSubtitle: 'Conciliador · Protheus',
  preview:
    'Prévia: o Conciliador está em construção. Já guarda o perfil de contas (Configuração) e reconhece os relatórios pelo conteúdo; a leitura dos arquivos e a conciliação chegam nas próximas etapas.',
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
