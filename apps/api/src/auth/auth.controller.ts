import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';

import { successResponse, errorResponse } from '../common/api-response';
import { AuthService } from './auth.service';

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
  githubCallback(@Body() _body: { code: string }) {
    // Stub kept for API compatibility; real OAuth sign-in arrives with P05 (D-003).
    return successResponse({ message: 'GitHub OAuth handled by NextAuth.js on frontend' });
  }

  @Post('google')
  googleCallback(@Body() _body: { code: string }) {
    // Stub kept for API compatibility; real OAuth sign-in arrives with P05 (D-003).
    return successResponse({ message: 'Google OAuth handled by NextAuth.js on frontend' });
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
