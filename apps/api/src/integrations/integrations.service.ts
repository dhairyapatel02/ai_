import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Provider, Prisma } from '@prisma/client';

@Injectable()
export class IntegrationsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async listIntegrations(userId: string) {
    return this.prisma.integration.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async connectGitHub(userId: string, accessToken: string, metadata: Prisma.InputJsonValue) {
    return this.prisma.integration.upsert({
      where: { userId_provider: { userId, provider: Provider.GITHUB } },
      update: { accessToken, metadata },
      create: { userId, provider: Provider.GITHUB, accessToken, metadata },
    });
  }

  async disconnect(userId: string, integrationId: string) {
    return this.prisma.integration.delete({
      where: { id: integrationId, userId },
    });
  }

  async getIntegration(userId: string, provider: Provider) {
    return this.prisma.integration.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  getGitHubOAuthUrl() {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const redirectUri = `${this.configService.get<string>('NEXTAUTH_URL')}/api/auth/callback/github`;
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user,user:email`;
  }
}
