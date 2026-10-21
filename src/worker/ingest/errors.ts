/** A reading failure with the stage where it happened and a message for the user (Portuguese). */
import type { Stage } from '../../shared/protocol';

export class IngestError extends Error {
  override name = 'IngestError';
  constructor(
    readonly stage: Stage,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}
