import { Injectable } from '@nestjs/common';

import { AppException } from '../common/app-exception';
import { afterCursor, decodeCursor, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

import type { PageQuery } from '@devimpact/shared';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async listDocuments(userId: string, query: PageQuery) {
    const [rows, total] = await Promise.all([
      this.prisma.generatedDocument.findMany({
        where: { userId, ...afterCursor('createdAt', decodeCursor(query.cursor)) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.generatedDocument.count({ where: { userId } }),
    ]);
    return toPage(rows, query.limit, (row) => row.createdAt, total);
  }

  async getDocument(userId: string, id: string) {
    const doc = await this.prisma.generatedDocument.findFirst({ where: { id, userId } });
    if (!doc) throw AppException.notFound('Document');
    return doc;
  }

  /** Explicit ownership check; real database errors surface as 500, not "not found" (BUG-12). */
  async deleteDocument(userId: string, id: string): Promise<{ deleted: true }> {
    const { count } = await this.prisma.generatedDocument.deleteMany({ where: { id, userId } });
    if (count === 0) throw AppException.notFound('Document');
    return { deleted: true };
  }
}
