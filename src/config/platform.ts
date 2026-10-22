import { z } from 'zod';
import { dateText } from './schema';

/**
 * Configuration of the platform, shared by every analysis module (docs/MODULOS.md, section 1): holidays, which are
 * not counted as business days. Saved apart from the configuration of each module.
 */
export const platformConfigSchema = z.object({
  schemaVersion: z.literal(1),
  holidays: z.array(dateText),
});

export type PlatformConfig = z.infer<typeof platformConfigSchema>;

/** The platform configuration read from IndexedDB or a backup; null when absent or invalid. */
export function readPlatformConfig(input: unknown): PlatformConfig | null {
  const parsed = platformConfigSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function platformConfigOf(holidays: readonly string[]): PlatformConfig {
  return { schemaVersion: 1, holidays: [...holidays] };
}
