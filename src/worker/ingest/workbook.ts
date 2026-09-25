/**
 * Resolves sheet names to ZIP entries through xl/workbook.xml and xl/_rels/workbook.xml.rels
 * (docs/REGRAS_CFGR700.md, section 1). These parts are small, so simple patterns are enough.
 */
import { decodeXmlEntities } from './xmlText';

export interface WorkbookSheet {
  name: string;
  relationshipId: string;
}

export interface Relationship {
  id: string;
  type: string;
  target: string;
}

function attr(attrs: string, pattern: RegExp): string | null {
  const m = pattern.exec(attrs);
  return m ? decodeXmlEntities(m[1]!) : null;
}

export function parseWorkbookSheets(xml: string): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1]!, /\sname="([^"]*)"/);
    const relationshipId = attr(m[1]!, /\s\w+:id="([^"]*)"/);
    if (name !== null && relationshipId !== null) sheets.push({ name, relationshipId });
  }
  return sheets;
}

export function parseRelationships(xml: string): Relationship[] {
  const rels: Relationship[] = [];
  for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1]!, /\sId="([^"]*)"/);
    const target = attr(m[1]!, /\sTarget="([^"]*)"/);
    const type = attr(m[1]!, /\sType="([^"]*)"/) ?? '';
    if (id !== null && target !== null) rels.push({ id, type, target });
  }
  return rels;
}

/** Target of a workbook relationship → ZIP entry name ("worksheets/sheet2.xml" → "xl/worksheets/sheet2.xml"). */
export function resolvePartPath(target: string, baseDir = 'xl'): string {
  const raw = target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`;
  const parts: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}
