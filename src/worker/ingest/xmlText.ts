const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five XML entities and numeric character references; unknown entities are kept. */
export function decodeXmlEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[body] ?? m;
  });
}

/** Decodes OOXML "_xHHHH_" escapes; "_x005F_" escapes a literal underscore. */
export function decodeOoxmlEscapes(s: string): string {
  if (s.indexOf('_x') < 0) return s;
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Text content of an element as it appears in the XML → the cell's string value. */
export function decodeCellText(raw: string): string {
  return decodeOoxmlEscapes(decodeXmlEntities(raw));
}
