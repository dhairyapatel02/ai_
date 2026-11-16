import { DocumentListQuery, IdParams } from '@devimpact/shared';
import { Controller, Delete, Get } from '@nestjs/common';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../auth/auth.decorators';
import { withMeta } from '../common/envelope.interceptor';
import { ApiDoc, ZodParams, ZodQuery } from '../common/zod-validation';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Get()
  @ApiDoc({
    summary: 'Generated documents, newest first (cursor pagination, total)',
    tags: ['documents'],
  })
  async list(@CurrentUser() user: AuthUser, @ZodQuery(DocumentListQuery) query: DocumentListQuery) {
    const page = await this.documentsService.listDocuments(user.id, query);
    return withMeta(page.items, page.meta);
  }

  @Get(':id')
  @ApiDoc({ summary: 'One document (v1 shape until P08)', tags: ['documents'] })
  get(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.documentsService.getDocument(user.id, params.id);
  }

  @Delete(':id')
  @ApiDoc({
    summary: 'Delete a document',
    tags: ['documents'],
    response: z.object({ deleted: z.literal(true) }),
  })
  delete(@CurrentUser() user: AuthUser, @ZodParams(IdParams) params: { id: string }) {
    return this.documentsService.deleteDocument(user.id, params.id);
  }
}
