import { Controller, Get, Post, Body, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { successResponse, errorResponse } from '../common/api-response';
import { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('github')
  async githubCallback(@Body() body: { code: string }) {
    try {
      // In production, exchange code for token via GitHub OAuth
      // For now, this is a placeholder for the NextAuth.js flow
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
