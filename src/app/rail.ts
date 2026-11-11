/**
 * The views of the rail (docs/INTERFACE.md, item 0): every view but the reconciliation is a feature of the module, so
 * the rail shows only what the descriptor offers, never by the id of the module (docs/MODULOS.md, section 1).
 */
import type { IconName } from '../components/Icon';
import type { AvailableModule } from '../modules/types';
import type { View } from './modules/workspace';

export const VIEWS: { id: View; label: string; icon: IconName; description: string }[] = [
  { id: 'reconciliation', label: 'Reconciliação', icon: 'reconciliation', description: 'Integridade dos arquivos, reconciliação de linhas e verificações' },
  { id: 'panel', label: 'Painel', icon: 'panel', description: 'Categorias por origem, competência, sinalizações e cobertura' },
  { id: 'findings', label: 'Achados', icon: 'flag', description: 'O que verificar: exceções, itens para conferir com aprovação e informativos' },
  { id: 'tables', label: 'Tabelas', icon: 'table', description: 'Documentos, linhas e eventos, com busca, filtros e ordenação' },
  { id: 'justifications', label: 'Justificativas', icon: 'justify', description: 'O motivo de cada documento excluído ou alterado' },
  { id: 'export', label: 'Exportação', icon: 'download', description: 'Papel de trabalho em Excel, gerado neste computador' },
];

export const offered = (m: AvailableModule, view: View) => view === 'reconciliation' || m.features[view];

/** The views of the rail for a module, in order. */
export const railViews = (m: AvailableModule) => VIEWS.filter((v) => offered(m, v.id));
