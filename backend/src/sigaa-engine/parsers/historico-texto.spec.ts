import { extrairItensHistorico } from './historico-texto';

/**
 * A minimal one-page PDF that shows "MATA55" at (72, 700). Hand-built rather
 * than committed as a binary so the bridge to pdf-parse is covered without
 * any real transcript entering the repository.
 */
function pdfSintetico(): Buffer {
  const conteudo = 'BT /F1 12 Tf 72 700 Td (MATA55) Tj ET';
  const objetos = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${conteudo.length} >> stream\n${conteudo}\nendstream endobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const objeto of objetos) {
    offsets.push(pdf.length);
    pdf += objeto;
  }
  const inicioXref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer << /Size ${objetos.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${inicioXref}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

describe('extrairItensHistorico', () => {
  it('returns one positioned item per non-empty text run', async () => {
    const itens = await extrairItensHistorico(pdfSintetico());

    expect(itens).toHaveLength(1);
    expect(itens[0]).toEqual({
      pagina: 1,
      x: 72,
      y: 700,
      texto: 'MATA55',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is untyped by design
      fontName: expect.any(String),
    });
  });

  it('rejects a buffer that is not a PDF instead of returning nothing', async () => {
    await expect(
      extrairItensHistorico(Buffer.from('<html>nope</html>')),
    ).rejects.toThrow();
  });
});
