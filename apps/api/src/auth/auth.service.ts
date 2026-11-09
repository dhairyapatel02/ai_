import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async findOrCreateUser(data: { email: string; name: string; avatar?: string }) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) return existing;

    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        avatar: data.avatar || null,
      },
    });
  }

  async getUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        integrations: { select: { id: true, provider: true, createdAt: true } },
      },
    });
  }
}
