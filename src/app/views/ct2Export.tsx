/** What the export screen says about the CT2 integrity workpaper (docs/REGRAS_CT2_INTEGRIDADE.md, section 7). */
import { Icon } from '../../components/Icon';
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
          <strong>Tamanho:</strong> a Base leva todas as colunas da extração. Extrações grandes geram arquivos grandes e levam mais tempo
          para abrir e recalcular no Excel.
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
