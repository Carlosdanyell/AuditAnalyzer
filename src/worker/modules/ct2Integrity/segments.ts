/**
 * The segment (balance type + currency) of every block and Base position, for the panel and the tables cut by
 * segment (decision of 29/10/2026). Segments are blocks of the Base order, so each level maps through the one above.
 */
import type { Ct2SegmentInfo } from '../../../shared/modules/ct2Integrity';
import type { Ct2Blocks } from './aggregate';
import type { Ct2Ingested } from './ingest';
import { textOf } from './profile';

export interface Ct2SegmentMap {
  segments: Ct2SegmentInfo[];
  ofDay: Uint32Array;
  ofBatch: Uint32Array;
  ofDocument: Uint32Array;
  ofPosition: Uint32Array;
}

const label = (balanceType: string, currency: string) => `Saldo ${balanceType || '(vazio)'} · Moeda ${currency || '(vazio)'}`;

export function segmentMap(base: Pick<Ct2Ingested, 'store' | 'order'>, b: Ct2Blocks): Ct2SegmentMap {
  const { store, order } = base;
  const ofDay = b.daySegment;
  const ofBatch = new Uint32Array(b.batches);
  for (let k = 0; k < b.batches; k++) ofBatch[k] = ofDay[b.batchDay[k]!]!;
  const ofDocument = new Uint32Array(b.documents);
  const ofPosition = new Uint32Array(order.length);
  for (let d = 0; d < b.documents; d++) {
    ofDocument[d] = ofBatch[b.documentBatch[d]!]!;
    ofPosition.fill(ofDocument[d]!, b.documentStart[d]!, b.documentStart[d + 1]!);
  }
  const segments = Array.from({ length: b.segments }, (_, s) => {
    const i = order[b.documentStart[b.batchStart[b.dayStart[b.segmentStart[s]!]!]!]!]!;
    const balanceType = textOf(store.text.balanceType, i);
    const currency = textOf(store.text.currency, i);
    return { index: s, balanceType, currency, label: label(balanceType, currency) };
  });
  return { segments, ofDay, ofBatch, ofDocument, ofPosition };
}
