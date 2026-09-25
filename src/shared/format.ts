// Presentation-layer formatting (pt-BR). Engine code must not import this module.

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${integer.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${oneDecimal.format(bytes / 1024)} KB`;
  return `${oneDecimal.format(bytes / (1024 * 1024))} MB`;
}

/** Duration as m:ss or h:mm:ss. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatCrc(crc: number): string {
  return crc.toString(16).toUpperCase().padStart(8, '0');
}

export { formatDateTime } from './dates';

/** Short durations: "850 ms", "4,5 s", or m:ss from one minute on. */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${integer.format(Math.round(ms))} ms`;
  if (ms < 60_000) return `${oneDecimal.format(ms / 1000)} s`;
  return formatDuration(ms);
}
