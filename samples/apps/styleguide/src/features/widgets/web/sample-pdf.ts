// Minimal text-only PDF so the viewer example needs no binary asset; xref offsets are computed.
function pageObjects(text: string, firstObjectNumber: number): readonly string[] {
  const stream = `BT /F1 14 Tf 56 760 Td (${text}) Tj ET`;
  return [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${firstObjectNumber + 1} 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
}

export function buildSamplePdfBase64(pageTexts: readonly string[]): string {
  const pageObjectNumbers = pageTexts.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
    ...pageTexts.flatMap((text, index) => pageObjects(text, pageObjectNumbers[index] ?? 3)),
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = body.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return btoa(body);
}
