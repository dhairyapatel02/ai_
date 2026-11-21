// Prints the text of a PDF read from stdin (test helper, run in a child process because
// pdfjs-dist is ESM-only and Jest runs CommonJS). Output: JSON { pages, text }.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const doc = await getDocument({
  data: new Uint8Array(Buffer.concat(chunks)),
  useSystemFonts: false,
}).promise;
const parts = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
}
process.stdout.write(
  JSON.stringify({ pages: doc.numPages, text: parts.join('\n').replace(/\s+/g, ' ') }),
);
