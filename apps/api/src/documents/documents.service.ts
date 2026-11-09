import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocumentsService {
  constructor(private prisma: PrismaService) {}

  async listDocuments(userId: string, page = 1, limit = 20) {
    const [data, total] = await Promise.all([
      this.prisma.generatedDocument.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.generatedDocument.count({ where: { userId } }),
    ]);

    return { data, total, page, limit };
  }

  async getDocument(userId: string, id: string) {
    return this.prisma.generatedDocument.findFirst({
      where: { id, userId },
    });
  }

  async deleteDocument(userId: string, id: string) {
    return this.prisma.generatedDocument.delete({
      where: { id, userId },
    });
  }
}
