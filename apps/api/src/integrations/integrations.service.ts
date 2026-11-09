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
    const frontendUrl = this.configService.get<string>('NEXTAUTH_URL') || 'http://localhost:3000';
    const redirectUri = `${frontendUrl}/connect/callback`;
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:user,user:email`;
  }

  async exchangeGitHubCode(userId: string, code: string) {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error(
        'GitHub OAuth credentials not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.',
      );
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || 'Failed to exchange GitHub code for token');
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const ghUser = (await userRes.json()) as { login?: string; name?: string; avatar_url?: string };

    return this.connectGitHub(userId, tokenData.access_token, {
      username: ghUser.login,
      name: ghUser.name,
      avatar: ghUser.avatar_url,
    });
  }
}
