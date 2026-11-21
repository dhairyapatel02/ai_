import {
  EXPORT_MIME,
  exportFilename,
  toExportDocument,
  toMarkdown,
  toPlainText,
  type ExportQuery,
} from '@devimpact/shared';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../common/app-exception';
import { DocumentsService } from '../documents/documents.service';
import { renderDocx } from './docx';
import { pageSizeFor, renderPdf } from './pdf';

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * `GET /documents/:id/export` (ADR-0012, API_CONTRACT_V2 §13.2): one export-blocks IR rendered
 * to Markdown, plain text, PDF or DOCX. The document (and version) is loaded through
 * `DocumentsService.get`, which scopes by `{ id, userId }` — another user's id is a 404.
 */
@Injectable()
export class DocumentExportsService {
  private readonly logger = new Logger(DocumentExportsService.name);

  constructor(private readonly documents: DocumentsService) {}

  async export(userId: string, id: string, query: ExportQuery): Promise<ExportFile> {
    const detail = await this.documents.get(userId, id, query.version);
    const doc = detail.document;
    const active = doc.status === 'pending' || doc.status === 'streaming';
    if (active && query.version === undefined) {
      throw new AppException('GENERATION_IN_PROGRESS', 'This document is still being written.', {
        documentId: doc.id,
      });
    }
    if (!detail.version) {
      throw new AppException('CONFLICT', 'This document has no content to export yet.', {
        reason: 'not_ready',
      });
    }
    const ir = toExportDocument({
      type: doc.type,
      title: doc.title,
      periodLabel: doc.period?.label ?? null,
      version: detail.version.number,
      content: detail.version.content,
      evidence: doc.evidence,
      ...(query.citations !== undefined ? { citations: query.citations } : {}),
    });
    const filename = exportFilename(
      doc.type,
      doc.period?.spec,
      detail.version.number,
      query.format,
    );
    const size = pageSizeFor(doc.period?.timezone);
    let body: Buffer;
    try {
      switch (query.format) {
        case 'md':
          body = Buffer.from(toMarkdown(ir), 'utf8');
          break;
        case 'txt':
          body = Buffer.from(toPlainText(ir), 'utf8');
          break;
        case 'pdf':
          body = await renderPdf(ir, size);
          break;
        case 'docx':
          body = await renderDocx(ir, size);
          break;
      }
    } catch (error) {
      this.logger.error({ err: error, documentId: doc.id, format: query.format }, 'export failed');
      throw new AppException('INTERNAL', "The export couldn't be created. Try again.");
    }
    return { filename, contentType: EXPORT_MIME[query.format], body };
  }
}
