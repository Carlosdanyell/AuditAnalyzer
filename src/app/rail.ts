/**
 * The views of the rail (docs/INTERFACE.md, item 0; flow revision of 25/11/2026): Leitura, Visão geral, Análise,
 * Justificativas and Exportação. Every view but the Leitura is a feature of the module, so the rail shows only what the
 * descriptor offers, never by the id of the module (docs/MODULOS.md, section 1).
 */
import type { IconName } from '../components/Icon';
import type { AvailableModule } from '../modules/types';
import type { View } from './modules/workspace';

export const VIEWS: { id: View; label: string; icon: IconName; description: string }[] = [
  { id: 'reading', label: 'Leitura', icon: 'reconciliation', description: 'Integridade dos arquivos, reconciliação de linhas e verificações' },
  { id: 'overview', label: 'Visão geral', icon: 'panel', description: 'Composição dos dados: totais e gráficos por segmento, período, origem ou conta' },
  { id: 'analysis', label: 'Análise', icon: 'flag', description: 'Os testes e as tabelas: escolha um teste, filtre e abra o detalhe de uma linha' },
  { id: 'justifications', label: 'Justificativas', icon: 'justify', description: 'O motivo de cada item excluído, alterado ou com diferença' },
  { id: 'export', label: 'Exportação', icon: 'download', description: 'Papel de trabalho em Excel, gerado neste computador' },
];

export const offered = (m: AvailableModule, view: View) => view === 'reading' || m.features[view];

/** The views of the rail for a module, in order. */
export const railViews = (m: AvailableModule) => VIEWS.filter((v) => offered(m, v.id));
