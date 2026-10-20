import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModuleSelector } from '../../src/components/ModuleSelector';
import { MODULES } from '../../src/modules/registry';

/** Selector of analyses on the start screen (docs/MODULOS.md, section 4). */
describe('module selector', () => {
  const html = renderToStaticMarkup(<ModuleSelector modules={MODULES} selected="cfgr700" onSelect={() => {}} helpBase="/AuditAnalyzer/" />);

  it('is a labelled group of options, one per module', () => {
    expect(html).toMatch(/role="radiogroup" aria-labelledby="[^"]+"/);
    expect(html.match(/role="radio"/g)).toHaveLength(2);
  });

  it('marks the selected module and shows what it expects', () => {
    expect(html).toMatch(/role="radio" aria-checked="true" aria-label="Log de auditoria \(CFGR700\)"/);
    expect(html).toContain('Relatório CFGR700 do Protheus (tabela CT2), em .xlsx');
  });

  it('shows the CT2 integrity module as coming soon, not selectable', () => {
    expect(html).toMatch(/role="radio" aria-checked="false" aria-label="Integridade da CT2"[^>]*disabled=""/);
    expect(html).toContain('Em breve');
  });

  it('links each available module to its section of the manual', () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toMatch(/<a [^>]*href="\/AuditAnalyzer\/ajuda\.html#cfgr700"[^>]*>[^<]*Manual desta análise/);
  });
});
