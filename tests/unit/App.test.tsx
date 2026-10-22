import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';

describe('start screen', () => {
  const html = renderToStaticMarkup(<App />);

  it('shows the privacy notice', () => {
    expect(html).toContain(
      'Os arquivos são processados neste computador e não são enviados para nenhum servidor.',
    );
  });

  it('offers an .xlsx file input that accepts several files', () => {
    expect(html).toMatch(/<input[^>]*type="file"[^>]*>/);
    expect(html).toContain('accept=".xlsx"');
    expect(html).toContain('multiple');
  });

  it('offers the "Encerrar sessão" button', () => {
    expect(html).toContain('Encerrar sessão');
  });
});

describe('start screen of the platform (docs/MODULOS.md, section 4)', () => {
  const html = renderToStaticMarkup(<App />);

  it('shows the selector of analyses with the CFGR700 module already chosen, next to the file area', () => {
    expect(html).toMatch(/role="radio" aria-checked="true" aria-label="Log de auditoria \(CFGR700\)"/);
    expect(html).toMatch(/aria-label="Integridade da CT2"/);
    expect(html).toContain('Carregue as extrações do CFGR700');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*>/);
  });
});
