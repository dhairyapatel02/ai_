import { Controller, Get, Delete, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';

import { successResponse, errorResponse } from '../common/api-response';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Get()
  async list(@Req() req: Request, @Query('page') page?: string, @Query('limit') limit?: string) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    if (isNaN(parsedPage) || isNaN(parsedLimit)) return errorResponse('Invalid page or limit');

    const result = await this.documentsService.listDocuments(userId, parsedPage, parsedLimit);
    return successResponse(result);
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    const doc = await this.documentsService.getDocument(userId, id);
    if (!doc) return errorResponse('Document not found');

    return successResponse(doc);
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id') id: string) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) return errorResponse('Not authenticated');

    try {
      await this.documentsService.deleteDocument(userId, id);
      return successResponse({ message: 'Document deleted' });
    } catch {
      return errorResponse('Document not found');
    }
  }
}
