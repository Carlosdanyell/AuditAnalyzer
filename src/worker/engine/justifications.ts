/**
 * Justification status of a document (docs/REGRAS_CFGR700.md, section 9). A justification covers files and a
 * last event; the document "moved after the justification" when it has a movement of that kind (deletion or
 * effective change) in a file not covered, after the last event covered.
 */
import { INVALID_TIME } from '../../shared/dates';
import { justificationKey, normalizeText } from '../../shared/justifications';
import type { CoverageCount, Justification, JustificationKind, JustificationStatus, Period } from '../../shared/protocol';
import type { ScopeAnalysis } from './analysis';
import type { DocumentInfo } from './documents';
import { visitPeriod } from './periods';

export interface DocumentMovement {
  /** Source files with a movement of the kind, ascending. */
  files: number[];
  /** Latest movement of the kind (seconds); INVALID_TIME when none. */
  lastEvent: number;
}

function movementBySource(scope: ScopeAnalysis, doc: DocumentInfo, kind: JustificationKind): Map<number, number> {
  const bySource = new Map<number, number>();
  const note = (source: number, t: number) => {
    if (source < 0 || t === INVALID_TIME) return;
    const prev = bySource.get(source);
    if (prev === undefined || t > prev) bySource.set(source, t);
  };
  for (const index of doc.records) {
    const r = scope.records[index]!;
    if (kind === 'deletion') {
      if (r.deleted) note(r.deletionSource, r.deletionTime);
    } else {
      for (const s of scope.sources) note(s, r.lastChangeBySource[s]!);
    }
  }
  return bySource;
}

export function documentMovement(scope: ScopeAnalysis, doc: DocumentInfo, kind: JustificationKind): DocumentMovement {
  const bySource = movementBySource(scope, doc, kind);
  const files = [...bySource.keys()].sort((a, b) => a - b);
  return { files, lastEvent: files.length ? Math.max(...bySource.values()) : INVALID_TIME };
}

export function justificationStatus(
  scope: ScopeAnalysis,
  doc: DocumentInfo,
  kind: JustificationKind,
  sourceNames: string[],
  justification: Justification | undefined,
): JustificationStatus {
  if (!justification || !normalizeText(justification.text)) return 'pending';
  const covered = new Set(justification.coverage.files.map((f) => f.toLowerCase()));
  const last = justification.coverage.lastEvent;
  for (const [source, t] of movementBySource(scope, doc, kind)) {
    const inCoveredFile = covered.has((sourceNames[source] ?? '').toLowerCase());
    if (!inCoveredFile && (last === null || t > last)) return 'moved';
  }
  return 'justified';
}

const emptyCount = (): CoverageCount => ({ total: 0, justified: 0, moved: 0, pending: 0 });

/** Distinct documents of the Excluído and Alterado categories of the period, by justification status. */
export function coverageCounts(
  scope: ScopeAnalysis,
  period: Period,
  justifications: ReadonlyMap<string, Justification>,
  sourceNames: string[],
): { deleted: CoverageCount; changed: CoverageCount } {
  const deleted = new Map<number, DocumentInfo>();
  const changed = new Map<number, DocumentInfo>();
  visitPeriod(scope, period, {
    line() {},
    document(category, d, index) {
      if (category === 'deleted') deleted.set(index, d);
      else if (category === 'changed') changed.set(index, d);
    },
  });
  const count = (docs: Map<number, DocumentInfo>, kind: JustificationKind) => {
    const c = emptyCount();
    for (const d of docs.values()) {
      c.total++;
      c[justificationStatus(scope, d, kind, sourceNames, justifications.get(justificationKey(kind, d.key)))]++;
    }
    return c;
  };
  return { deleted: count(deleted, 'deletion'), changed: count(changed, 'change') };
}

/** What identifies a document in the justification lists, besides its key. */
export interface DocumentIdentification {
  /** Debit of all lines recorded in the log (cents). */
  documentDebitCents: number;
  /** Debit of the deleted lines (cents). */
  deletedDebitCents: number;
  /** First non-empty history among the lines, in line order; '' when none is in the log. */
  history: string;
}

export function documentIdentification(scope: ScopeAnalysis, doc: DocumentInfo, historyField: string): DocumentIdentification {
  const { dict, fields } = scope.log;
  const fieldId = dict.find(historyField);
  const keep = fieldId >= 0 ? fields.keepIndex.get(fieldId) : undefined;
  let deleted = 0;
  let history = '';
  for (const index of doc.records) {
    const r = scope.records[index]!;
    if (r.deleted) deleted += r.debitCents;
    if (!history && keep !== undefined && r.values[keep]! >= 0) history = dict.get(r.values[keep]!).trim();
  }
  return { documentDebitCents: doc.debitRecorded, deletedDebitCents: deleted, history };
}
