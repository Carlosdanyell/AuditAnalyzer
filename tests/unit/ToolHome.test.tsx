import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolHome } from '../../src/components/ToolHome';
import { cfgr700Module } from '../../src/modules/cfgr700/module';
import { MODULES } from '../../src/modules/registry';
import type { ComingSoonModule } from '../../src/modules/types';

/** Start of the platform (docs/MODULOS.md, section 4): one card per tool, with its icon and highlights. */
describe('tool cards', () => {
  const render = (props: Partial<Parameters<typeof ToolHome>[0]> = {}) =>
    renderToStaticMarkup(<ToolHome modules={MODULES} lastUsed={null} open={null} onOpen={() => {}} helpBase="/AuditAnalyzer/" {...props} />);

  it('offers one button per tool, named by its title, with what it reads', () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*aria-label="Log de auditoria \(CFGR700\)"/);
    expect(html).toMatch(/<button[^>]*aria-label="Integridade da CT2"/);
    expect(html).toContain('Relatório CFGR700 da CT2 · .xlsx');
    expect(html).toMatch(/<button[^>]*aria-label="Conciliador"/);
    // Only the Conciliador is in preview (Phase 15); a tool in preview gets the mark.
    expect(html.match(/>Prévia</g)).toHaveLength(1);
    const inPreview = render({ modules: MODULES.map((m) => (m.status === 'available' && m.id === 'ct2Integrity' ? { ...m, preview: 'Prévia: em conferência.' } : m)) });
    expect(inPreview.match(/>Prévia</g)).toHaveLength(2);
  });

  it('shows each tool as a card with its own icon and what it does best', () => {
    const html = render();
    expect(html).toContain('data-icon="auditLog"');
    expect(html).toContain('data-icon="ledger"');
    expect(html).toContain('data-icon="reconcile"');
    for (const m of MODULES) {
      expect(m.highlights.length).toBeGreaterThanOrEqual(2);
      expect(m.highlights.length).toBeLessThanOrEqual(3);
      for (const h of m.highlights) expect(html).toContain(h);
    }
    // The call to open the tool is visible on every card (the button over the card carries the name).
    expect(html.match(/>Abrir</g)).toHaveLength(MODULES.length);
    // Short texts on the card (25/11/2026): one sentence, short highlights and a compact format line.
    for (const m of MODULES) {
      expect(m.description.length, m.id).toBeLessThanOrEqual(100);
      expect(m.input.length, m.id).toBeLessThanOrEqual(70);
      for (const h of m.highlights) expect(h.length, h).toBeLessThanOrEqual(48);
    }
  });

  it('gives each tool its accent from the descriptor (steel when absent), never by comparing ids', () => {
    const html = render();
    expect(html).toContain('data-accent="steel"');
    expect(html).toContain('data-accent="teal"');
    expect(html).toContain('data-accent="ochre"');
    const plain = render({
      modules: MODULES.map((m) => {
        const copy = { ...m };
        delete copy.accent;
        return copy;
      }),
    });
    expect(plain.match(/data-accent="steel"/g)).toHaveLength(MODULES.length);
  });

  it('links each tool to its section of the manual', () => {
    const html = render();
    expect(html).toMatch(/href="\/AuditAnalyzer\/ajuda\.html#cfgr700"/);
    expect(html).toMatch(/href="\/AuditAnalyzer\/ajuda\.html#ct2"/);
    expect(html).toMatch(/href="\/AuditAnalyzer\/ajuda\.html#reconciliation"/);
  });

  it('marks the tool used last, and the open analysis instead when there is one', () => {
    expect(render({ lastUsed: 'ct2Integrity' })).toContain('Última usada');
    const open = render({ lastUsed: 'cfgr700', open: { id: 'cfgr700', label: 'Análise aberta' } });
    expect(open).toContain('Análise aberta');
    expect(open).toContain('Voltar à análise');
    expect(open).not.toContain('Última usada');
  });

  it('shows a tool announced for later as coming soon, not openable and without a manual', () => {
    const soon: ComingSoonModule = { status: 'comingSoon', id: 'ct2Integrity', title: 'Outra análise', description: 'Em preparo.', input: 'Arquivo .xlsx', icon: 'ledger', highlights: ['Em preparo'], helpAnchor: null };
    const html = render({ modules: [cfgr700Module, soon] });
    expect(html).toMatch(/<button[^>]*aria-label="Outra análise"[^>]*disabled=""/);
    expect(html).toContain('Em breve');
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
