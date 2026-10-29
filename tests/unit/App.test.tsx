import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { FileDrop } from '../../src/components/FileDrop';

describe('start of the platform (docs/MODULOS.md, section 4)', () => {
  const html = renderToStaticMarkup(<App />);

  it('shows the privacy notice', () => {
    expect(html).toContain('Os arquivos são processados neste computador e não são enviados para nenhum servidor.');
  });

  it('lists the tools; the file area comes with the tool opened', () => {
    expect(html).toMatch(/<h1>Ferramentas<\/h1>/);
    expect(html).toMatch(/aria-label="Log de auditoria \(CFGR700\)"/);
    expect(html).toMatch(/aria-label="Integridade da CT2"/);
    expect(html).not.toMatch(/type="file"/);
  });

  it('offers the "Encerrar sessão" button and the theme toggle', () => {
    expect(html).toContain('Encerrar sessão');
    expect(html).toMatch(/aria-label="Usar tema escuro"/);
  });
});

describe('file area of a tool', () => {
  it('offers an .xlsx file input that accepts several files', () => {
    const html = renderToStaticMarkup(<FileDrop onFiles={() => {}} />);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*>/);
    expect(html).toContain('accept=".xlsx"');
    expect(html).toContain('multiple');
  });
});
