import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModuleSelector } from '../../src/components/ModuleSelector';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { MODULES } from '../../src/modules/registry';
import type { ComingSoonModule } from '../../src/modules/types';

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

  it('offers the CT2 integrity module, marked as a preview', () => {
    expect(html).toMatch(/role="radio" aria-checked="false" aria-label="Integridade da CT2"/);
    expect(html).not.toMatch(/aria-label="Integridade da CT2"[^>]*disabled=""/);
    expect(html.match(/Prévia/g)).toHaveLength(1);
    expect(html).not.toContain('Em breve');
  });

  it('shows a module announced for later as coming soon, not selectable and without a manual', () => {
    const soon: ComingSoonModule = { status: 'comingSoon', id: 'ct2Integrity', title: 'Outra análise', description: 'Em preparo.', input: 'Arquivo .xlsx', helpAnchor: null };
    const markup = renderToStaticMarkup(<ModuleSelector modules={[cfgr700Module, soon]} selected="cfgr700" onSelect={() => {}} helpBase="/AuditAnalyzer/" />);
    expect(markup).toMatch(/role="radio" aria-checked="false" aria-label="Outra análise"[^>]*disabled=""/);
    expect(markup).toContain('Em breve');
    expect(markup.match(/<a /g)).toHaveLength(1);
  });

  it('links each available module to its section of the manual', () => {
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toMatch(/<a [^>]*href="\/AuditAnalyzer\/ajuda\.html#cfgr700"[^>]*>[^<]*Manual desta análise/);
    expect(html).toMatch(/<a [^>]*href="\/AuditAnalyzer\/ajuda\.html#ct2"[^>]*>[^<]*Manual desta análise/);
  });
});
