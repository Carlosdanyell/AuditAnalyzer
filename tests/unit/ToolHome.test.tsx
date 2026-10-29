import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolHome } from '../../src/components/ToolHome';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { MODULES } from '../../src/modules/registry';
import type { ComingSoonModule } from '../../src/modules/types';

/** Start of the platform (docs/MODULOS.md, section 4): one card per tool. */
describe('tool cards', () => {
  const render = (props: Partial<Parameters<typeof ToolHome>[0]> = {}) =>
    renderToStaticMarkup(<ToolHome modules={MODULES} lastUsed={null} open={null} onOpen={() => {}} helpBase="/AuditAnalyzer/" {...props} />);

  it('offers one button per tool, named by its title, with what it reads', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*aria-label="Log de auditoria \(CFGR700\)"/);
    expect(html).toMatch(/<button[^>]*aria-label="Integridade da CT2"/);
    expect(html).toContain('Relatório CFGR700 do Protheus (tabela CT2), em .xlsx');
    expect(html.match(/Prévia/g)).toHaveLength(1);
  });

  it('links each tool to its section of the manual', () => {
    const html = render();
    expect(html).toMatch(/href="\/AuditAnalyzer\/ajuda\.html#cfgr700"/);
    expect(html).toMatch(/href="\/AuditAnalyzer\/ajuda\.html#ct2"/);
  });

  it('marks the tool used last, and the open analysis instead when there is one', () => {
    expect(render({ lastUsed: 'ct2Integrity' })).toContain('Última usada');
    const open = render({ lastUsed: 'cfgr700', open: { id: 'cfgr700', label: 'Análise aberta' } });
    expect(open).toContain('Análise aberta');
    expect(open).toContain('Voltar à análise');
    expect(open).not.toContain('Última usada');
  });

  it('shows a tool announced for later as coming soon, not openable and without a manual', () => {
    const soon: ComingSoonModule = { status: 'comingSoon', id: 'ct2Integrity', title: 'Outra análise', description: 'Em preparo.', input: 'Arquivo .xlsx', helpAnchor: null };
    const html = render({ modules: [cfgr700Module, soon] });
    expect(html).toMatch(/<button[^>]*aria-label="Outra análise"[^>]*disabled=""/);
    expect(html).toContain('Em breve');
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
