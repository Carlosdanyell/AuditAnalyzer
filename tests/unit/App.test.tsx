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
