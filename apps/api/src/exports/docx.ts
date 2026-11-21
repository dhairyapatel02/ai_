import { cleanText, isHttpUrl, type ExportBlock, type ExportDocument } from '@devimpact/shared';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';

import type { PageSize } from './pdf';

/**
 * DOCX renderer (ADR-0012): the `docx` package with Word's built-in heading styles, so the file
 * stays editable in Word / Google Docs. Same blocks and evidence numbering as the PDF.
 */
// typescript-eslint resolves `bold` / `italics` in run options to the deprecated String.prototype
// HTML methods; they are docx run properties here.
/* eslint-disable @typescript-eslint/no-deprecated */
const FONT = 'Calibri';
const MONO = 'Consolas';
const COLOR = { text: '1C1F24', muted: '5B616E', accent: '3A4FD8', rule: 'E3E5E9' };
// Twips (1/1440 in): A4 11906 × 16838, Letter 12240 × 15840; 1 in margins.
const PAGE = { A4: { width: 11906, height: 16838 }, LETTER: { width: 12240, height: 15840 } };

const noteRuns = (notes: number[]): TextRun[] =>
  notes.length
    ? [
        new TextRun({
          text: ` ${notes.map((n) => `[${n}]`).join('')}`,
          superScript: true,
          color: COLOR.accent,
        }),
      ]
    : [];

function blockToDocx(block: ExportBlock): (Paragraph | Table)[] {
  switch (block.kind) {
    case 'heading':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
          children: [new TextRun(cleanText(block.text))],
        }),
      ];
    case 'paragraph':
      return [
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun(cleanText(block.text)), ...noteRuns(block.notes)],
        }),
      ];
    case 'list':
      return block.items.map(
        (item) =>
          new Paragraph({
            numbering: { reference: 'bullets', level: 0 },
            spacing: { after: 80 },
            children: [
              ...(item.title
                ? [new TextRun({ text: `${cleanText(item.title)}. `, bold: true })]
                : []),
              new TextRun(cleanText(item.text)),
              ...noteRuns(item.notes),
            ],
          }),
      );
    case 'table': {
      const border = { style: BorderStyle.SINGLE, size: 4, color: COLOR.rule };
      const borders = {
        top: border,
        bottom: border,
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      };
      const cell = (text: string, opts: { header?: boolean; right?: boolean } = {}) =>
        new TableCell({
          borders,
          margins: { top: 60, bottom: 60, left: 0, right: 0 },
          children: [
            new Paragraph({
              alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [
                new TextRun({
                  text: cleanText(text),
                  bold: opts.header,
                  color: opts.header ? COLOR.muted : COLOR.text,
                }),
              ],
            }),
          ],
        });
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: [6400, 2626],
          rows: [
            new TableRow({
              tableHeader: true,
              children: [
                cell(block.columns[0], { header: true }),
                cell(block.columns[1], { header: true, right: true }),
              ],
            }),
            ...block.rows.map(
              ([k, v]) =>
                new TableRow({ cantSplit: true, children: [cell(k), cell(v, { right: true })] }),
            ),
          ],
        }),
      ];
    }
    case 'note':
      return [
        new Paragraph({
          spacing: { before: 80, after: 120 },
          children: [
            new TextRun({
              text: cleanText(block.text),
              italics: true,
              color: COLOR.muted,
              size: 18,
            }),
          ],
        }),
      ];
  }
}

export async function renderDocx(doc: ExportDocument, size: PageSize = 'A4'): Promise<Buffer> {
  const body: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({ text: cleanText(doc.subtitle).toUpperCase(), color: COLOR.muted, size: 17 }),
      ],
    }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(cleanText(doc.title))] }),
    ...doc.blocks.flatMap(blockToDocx),
  ];
  if (doc.footnotes.length) {
    body.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        children: [new TextRun('Evidence')],
      }),
    );
    for (const f of doc.footnotes) {
      const children: ParagraphChild[] = [
        new TextRun({ text: `[${f.n}] `, color: COLOR.muted }),
        new TextRun({ text: f.ref, font: MONO, size: 17 }),
      ];
      if (f.title) children.push(new TextRun(` — ${cleanText(f.title)}`));
      if (f.url && isHttpUrl(f.url)) {
        children.push(
          new TextRun(' · '),
          new ExternalHyperlink({
            link: f.url,
            children: [new TextRun({ text: 'GitHub', style: 'Hyperlink' })],
          }),
        );
      }
      body.push(new Paragraph({ spacing: { after: 60 }, children }));
    }
  }

  const document = new Document({
    title: cleanText(doc.title),
    subject: cleanText(doc.subtitle),
    creator: 'DevImpact',
    description: 'Written with DevImpact from GitHub activity',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21, color: COLOR.text },
          paragraph: { spacing: { line: 300 } },
        },
        title: {
          run: { font: FONT, size: 40, bold: true, color: COLOR.text },
          paragraph: { spacing: { before: 60, after: 240 } },
        },
        heading2: {
          run: { font: FONT, size: 25, bold: true, color: COLOR.text },
          paragraph: { spacing: { before: 320, after: 120 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: PAGE[size],
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: 'Written with DevImpact · ', color: COLOR.muted, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], color: COLOR.muted, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(document);
}
