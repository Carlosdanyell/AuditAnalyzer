import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExportView } from '../../src/app/views/ExportView';
import { CT2_EXPORT, ct2TooLarge } from '../../src/app/views/ct2Export';
import type { WorkerClient } from '../../src/app/workerClient';
import type { Ct2Summary } from '../../src/shared/modules/ct2Integrity';

/** Export screen of the CT2 module (docs/REGRAS_CT2_INTEGRIDADE.md, sections 7.9 and 13). */
const summary = (lines: number): Ct2Summary => ({ module: 'ct2Integrity', lines, segments: [], documents: 0, batches: 0, days: 0, firstDay: null, lastDay: null });

describe('CT2 export screen', () => {
  it('says why a Base above 300 thousand lines cannot be exported, and nothing up to it', () => {
    expect(ct2TooLarge(null)).toBeNull();
    expect(ct2TooLarge(summary(300_000))).toBeNull();
    expect(ct2TooLarge(summary(300_001))).toMatch(/^A base tem 300\.001 linhas e a planilha amarrada por fórmulas aceita até 300\.000 linhas por exportação/);
  });

  it('keeps the button disabled, with the reason, when the analysis is too large', () => {
    const render = (unavailable: string | null) =>
      renderToStaticMarkup(
        <ExportView client={{} as WorkerClient} scopes={null} scope={0} onScopeChange={() => {}} failures={[]} content={CT2_EXPORT} unavailable={unavailable} />,
      );
    expect(render(null)).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*<svg[^>]*>.*?Gerar planilha/);
    const html = render(ct2TooLarge(summary(400_000)));
    expect(html).toContain('A base tem 400.000 linhas');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Gerar planilha/);
    // No scope to choose in the CT2.
    expect(html).not.toContain('Escopo');
  });
});
