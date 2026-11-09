import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { successResponse, errorResponse } from '../common/api-response';
import { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('dev-login')
  async devLogin(@Body() body: { email?: string; name?: string }) {
    try {
      const email = body.email || 'dev@devimpact.ai';
      const name = body.name || 'Dev User';
      const user = await this.authService.findOrCreateUser({ email, name });
      return successResponse(user);
    } catch (error) {
      return errorResponse('Login failed');
    }
  }

  @Post('github')
  async githubCallback(@Body() body: { code: string }) {
    try {
      return successResponse({ message: 'GitHub OAuth handled by NextAuth.js on frontend' });
    } catch (error) {
      return errorResponse('GitHub authentication failed');
    }
  }

  @Post('google')
  async googleCallback(@Body() body: { code: string }) {
    try {
      return successResponse({ message: 'Google OAuth handled by NextAuth.js on frontend' });
    } catch (error) {
      return errorResponse('Google authentication failed');
    }
  }

  @Get('me')
  async getMe(@Req() req: Request) {
    const userId = req.headers['x-user-id'] as string;
    if (!userId) {
      return errorResponse('Not authenticated');
    }

    const user = await this.authService.getUserById(userId);
    if (!user) {
      return errorResponse('User not found');
    }

    return successResponse(user);
  }
}
