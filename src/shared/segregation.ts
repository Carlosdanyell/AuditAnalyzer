/**
 * Segregated analysis by balance type (docs/REGRAS_CFGR700.md, section 13): identifiers shared by the worker and the
 * screen, and the Portuguese texts (the English ones are in src/worker/export/labels.ts). `{from}` and `{to}` are the
 * configured balance types (balanceType.expectedFrom and expectedTo: 9 and 1 for CT2).
 */

/** Phases in display order. Every event belongs to exactly one. */
export const PHASES = ['pre', 'activation', 'posted', 'other', 'undetermined'] as const;
export type Phase = (typeof PHASES)[number];

/** How the balance type at the time of the event was obtained. */
export const BALANCE_SOURCES = ['direct', 'rebuilt', 'undetermined'] as const;
export type BalanceSource = (typeof BALANCE_SOURCES)[number];

/** Exceptions to the premise, in precedence order (an event shows the first one that applies). */
export const EXCEPTIONS = ['reopening', 'afterReopening', 'directInsert', 'postedChange', 'postedDeletion', 'otherBalance'] as const;
export type ExceptionId = (typeof EXCEPTIONS)[number];

/** Events in the posted phase that are expected (informative, not exceptions). */
export const INFORMATIVES = ['postedStamp', 'postedRestore'] as const;
export type InformativeId = (typeof INFORMATIVES)[number];

/** Marks shown next to the event. "reopened" is the mark of the events after a reopening. */
export const MARKS = ['activationWithContent', 'sameSecond', 'reopened'] as const;
export type MarkId = (typeof MARKS)[number];

export type SameUser = 'yes' | 'no' | 'not-evaluable';

export interface SegregationTexts {
  phases: Record<Phase, string>;
  sources: Record<BalanceSource, string>;
  exceptions: Record<ExceptionId, string>;
  informatives: Record<InformativeId, string>;
  marks: Record<MarkId, string>;
  sameUser: Record<SameUser, string>;
  /** Limitations to declare (section 13), shown in the panel and written to the criteria sheet. */
  limitations: string;
}

export const SEGREGATION_PT: SegregationTexts = {
  phases: {
    pre: 'Pré-lançamento ({from})',
    activation: 'Efetivação',
    posted: 'Postado ({to})',
    other: 'Outro tipo de saldo',
    undetermined: 'Não determinado',
  },
  sources: { direct: 'Direta', rebuilt: 'Reconstruída', undetermined: 'Não determinado' },
  exceptions: {
    reopening: 'Reabertura',
    afterReopening: 'Evento após reabertura',
    directInsert: 'Inclusão direta em saldo {to}',
    postedChange: 'Alteração em lançamento postado',
    postedDeletion: 'Exclusão de lançamento postado',
    otherBalance: 'Tipo de saldo diferente de {from} e {to}',
  },
  informatives: {
    postedStamp: 'Somente carimbo em saldo {to}',
    postedRestore: 'Recuperação em saldo {to}',
  },
  marks: {
    activationWithContent: 'Efetivação com alteração de conteúdo',
    sameSecond: 'Ordem no mesmo segundo',
    reopened: 'Reaberto após efetivação',
  },
  sameUser: { yes: 'Sim', no: 'Não', 'not-evaluable': 'Não avaliável' },
  limitations:
    'A análise segregada classifica cada evento pelo tipo de saldo do registro no momento em que o evento ocorreu: ' +
    'pré-lançamento (9) ou lançamento postado (1). O tipo de saldo é lido diretamente do log na inclusão, na exclusão e ' +
    'na efetivação. Nas alterações, é reconstruído a partir dos eventos anteriores do mesmo registro; quando o registro ' +
    'foi lançado antes do período carregado e não há efetivação posterior, o tipo de saldo é informado como "Não ' +
    'determinado" e não é presumido. Para eliminar esses casos, extraia o CFGR700 com "Exclui campos não alterados = ' +
    'Não" ou consulte a CT2 pelo Recno. Correções de lançamentos postados são feitas por estorno e novo lançamento e ' +
    'aparecem como inclusões, não como alterações. A soma das fases é sempre igual à análise geral.',
};

/** Replaces {from} and {to} with the configured balance types. */
export function balanceText(template: string, balanceType: { expectedFrom: string; expectedTo: string }): string {
  return template.replace(/\{from\}/g, balanceType.expectedFrom).replace(/\{to\}/g, balanceType.expectedTo);
}
