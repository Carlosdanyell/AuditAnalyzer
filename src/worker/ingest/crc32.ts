/** CRC-32 (IEEE 802.3, as used by ZIP), slice-by-8. Incremental: crc32(b, crc32(a)) = crc32(a ++ b). */

const TABLES = (() => {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n]!;
    for (let k = 1; k < 8; k++) {
      c = t[c & 0xff]! ^ (c >>> 8);
      t[k * 256 + n] = c >>> 0;
    }
  }
  return t;
})();

export function crc32(data: Uint8Array, previous = 0): number {
  const t = TABLES;
  let crc = ~previous >>> 0;
  let i = 0;
  const n = data.length;
  const end8 = n - (n % 8);
  while (i < end8) {
    const a = (data[i]! | (data[i + 1]! << 8) | (data[i + 2]! << 16) | (data[i + 3]! << 24)) ^ crc;
    const b = data[i + 4]! | (data[i + 5]! << 8) | (data[i + 6]! << 16) | (data[i + 7]! << 24);
    crc =
      t[1792 + (a & 0xff)]! ^
      t[1536 + ((a >>> 8) & 0xff)]! ^
      t[1280 + ((a >>> 16) & 0xff)]! ^
      t[1024 + (a >>> 24)]! ^
      t[768 + (b & 0xff)]! ^
      t[512 + ((b >>> 8) & 0xff)]! ^
      t[256 + ((b >>> 16) & 0xff)]! ^
      t[b >>> 24]!;
    i += 8;
  }
  while (i < n) crc = t[(crc ^ data[i++]!) & 0xff]! ^ (crc >>> 8);
  return ~crc >>> 0;
}
