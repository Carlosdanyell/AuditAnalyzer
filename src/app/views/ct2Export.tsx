/** What the export screen says about the CT2 integrity workpaper (docs/REGRAS_CT2_INTEGRIDADE.md, section 7). */
import { Icon } from '../../components/Icon';
import { formatInteger } from '../../shared/format';
import { CT2_BASE_SHEET_ROWS, CT2_MAX_EXPORT_ROWS, type Ct2Summary } from '../../shared/modules/ct2Integrity';
import type { ExportContent } from './ExportView';

export const CT2_EXPORT: ExportContent = {
  intro:
    'A planilha é gerada neste computador e salva pelo navegador. Ela é toda amarrada por fórmulas: Documentos, Lotes e Dias somam os blocos da Base, e o Resumo prova que nada ficou de fora. Mudar um parâmetro na aba Criterios recalcula testes e status.',
  facts: (
    <>
      <li>
        <Icon name="calendar" size={16} />
        <span>
          <strong>Período e parâmetros:</strong> os da análise na tela (período de todos os meses lidos, tolerância e limite de linhas da
          configuração); editáveis na aba Criterios.
        </span>
      </li>
      <li>
        <Icon name="sheet" size={16} />
        <span>
          <strong>Tamanho:</strong> a Base leva todas as colunas da extração, até {formatInteger(CT2_MAX_EXPORT_ROWS)} linhas por
          exportação, em abas de até {formatInteger(CT2_BASE_SHEET_ROWS)} linhas que nunca dividem um dia. Um ano típico, com 450 mil
          linhas, dá um arquivo de ~330 MB que leva alguns minutos para recalcular ao abrir.
        </span>
      </li>
    </>
  ),
  sheets: [
    ['Resumo', 'indicadores por tipo de saldo e moeda, matriz de amarração, quadro de testes e conclusão', 'panel'],
    ['Criterios', 'parâmetros como nomes definidos (P_TOL, P_DATA_INI…), regra de cada teste e limitações', 'sliders'],
    ['Documentos, Lotes e Dias', 'uma linha por bloco, com somas e testes por fórmula', 'layers'],
    ['Excecoes', 'cada ocorrência de Erro ou Alerta, confirmada na origem por fórmula', 'flag'],
    ['Perfil', 'por rotina, lançamento padrão e origem; Seq CTK e limite de linhas', 'table'],
    ['Base e Rastreabilidade', 'a extração ordenada com as colunas de teste; SHA-256, leitura e verificações', 'hash'],
  ],
  tabs: ['Resumo', 'Criterios', 'Documentos', 'Lotes', 'Dias', 'Excecoes'],
};

/** Why the analysis on screen cannot be exported: a Base above the lines of one export (CI-8). */
export function ct2TooLarge(summary: Ct2Summary | null): string | null {
  if (!summary || summary.lines <= CT2_MAX_EXPORT_ROWS) return null;
  return (
    `A base tem ${formatInteger(summary.lines)} linhas e a planilha amarrada por fórmulas aceita até ${formatInteger(CT2_MAX_EXPORT_ROWS)} ` +
    'linhas por exportação (acima disso o Excel não recalcula em tempo viável). Divida a extração, por exemplo por semestre ou trimestre, e analise cada parte. O quadro de testes vale para a extração inteira.'
  );
}

