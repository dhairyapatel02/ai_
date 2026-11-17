import {
  CreateDocumentInput,
  CreateDocumentResponse,
  DocumentDetail,
  DocumentListQuery,
  DocumentOptions,
  DocumentSummary,
  DocumentVersionListItem,
  DocumentVersionQuery,
  IdParams,
  PreviewEvidenceResponse,
  RegenerateDocumentInput,
  UpdateDocumentInput,
  VersionListQuery,
  VersionParams,
} from '@devimpact/shared';
import { Controller, Delete, Get, Headers, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { RawResponse, withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodBody, ZodParams, ZodQuery } from '../common/zod-validation';
import { RateLimit } from '../throttle/rate-limit';
import { DocumentStreamService } from './document-stream.service';
import { DocumentsService } from './documents.service';

import type { Request, Response } from 'express';

/** API_CONTRACT_V2 §13 — documents & generation (F-40–F-50). */
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly streams: DocumentStreamService,
  ) {}

  @Get()
  @ApiDoc({
    summary: 'Document library (filter by type, search title, sort; cursor pagination, total)',
    tags: ['documents'],
    response: z.array(DocumentSummary),
  })
  async list(@CurrentUser() user: AuthUser, @ZodQuery(DocumentListQuery) query: DocumentListQuery) {
    const page = await this.documents.list(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Post('preview-evidence')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Evidence and engine metrics a document would use (no AI, no quota)',
    tags: ['documents'],
    response: PreviewEvidenceResponse,
  })
  preview(@CurrentUser() user: AuthUser, @ZodBody(DocumentOptions) body: DocumentOptions) {
    return this.documents.previewEvidence(user.id, body);
  }

  @Post()
  @RateLimit('ai')
  @ApiDoc({
    summary:
      'Create a document: 200 cache hit (same inputHash) or 201 pending + streamUrl (generation runs in the worker)',
    tags: ['documents'],
    rateLimit: 'ai',
    response: CreateDocumentResponse,
    status: 201,
  })
  async create(
    @CurrentUser() user: AuthUser,
    @ZodBody(CreateDocumentInput) body: CreateDocumentInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { status, ...result } = await this.documents.create(user.id, body);
    res.status(status);
    return result;
  }

  @Get(':id')
  @ApiDoc({
    summary: 'A document with one version (default current) and its cited evidence (A-3)',
    tags: ['documents'],
    response: DocumentDetail,
  })
  get(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodQuery(DocumentVersionQuery) query: { version?: number },
  ) {
    return this.documents.get(user.id, params.id, query.version);
  }

  @Get(':id/stream')
  @RawResponse()
  @RateLimit('sse')
  @ApiDoc({
    summary: 'Server-Sent Events of a generation (status, section, delta, done/error/cancelled)',
    tags: ['documents'],
    rateLimit: 'sse',
  })
  async stream(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.streams.stream(user.id, params.id, lastEventId, req, res);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Cancel a pending/streaming generation (no quota consumed)',
    tags: ['documents'],
    response: z.object({ document: DocumentSummary }),
  })
  cancel(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.documents.cancel(user.id, params.id);
  }

  @Patch(':id')
  @ApiDoc({
    summary: 'Edit title/content (new version, source user_edit; autosave window 30 s)',
    tags: ['documents'],
    response: DocumentDetail,
  })
  update(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(UpdateDocumentInput) body: UpdateDocumentInput,
  ) {
    return this.documents.update(user.id, params.id, body);
  }

  @Get(':id/versions')
  @ApiDoc({
    summary: 'Version history, newest first',
    tags: ['documents'],
    response: z.array(DocumentVersionListItem),
  })
  async versions(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodQuery(VersionListQuery) query: { cursor?: string; limit: number },
  ) {
    const page = await this.documents.versions(user.id, params.id, query);
    return withMeta(page.items, page.meta);
  }

  @Post(':id/versions/:n/restore')
  @HttpCode(200)
  @ApiDoc({
    summary: 'Restore a version (new version, source restore)',
    tags: ['documents'],
    response: DocumentDetail,
  })
  restore(@CurrentUser() user: AuthUser, @ZodParams(VersionParams) params: { id: string; n: number }) {
    return this.documents.restore(user.id, params.id, params.n);
  }

  @Post(':id/regenerate')
  @RateLimit('ai')
  @ApiDoc({
    summary: 'Regenerate the document (next version) or a single section',
    tags: ['documents'],
    rateLimit: 'ai',
    status: 201,
    response: z.object({ document: DocumentSummary, streamUrl: z.string() }),
  })
  regenerate(
    @CurrentUser() user: AuthUser,
    @ZodParams(IdParams) params: { id: string },
    @ZodBody(RegenerateDocumentInput) body: RegenerateDocumentInput,
  ) {
    return this.documents.regenerate(user.id, params.id, body);
  }

  @Delete(':id')
  @ApiDoc({
    summary: 'Delete a document (and its versions)',
    tags: ['documents'],
    response: z.object({ deleted: z.literal(true) }),
  })
  delete(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.documents.delete(user.id, params.id);
  }
}
