import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, jest } from '@jest/globals';

import { AuthProfileController, AuthSessionController } from './auth-session.controller';

describe('AuthSessionController response contracts', () => {
  it('uses HTTP 200 for refresh and logout mutations', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, AuthSessionController.prototype.refresh)).toBe(200);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, AuthSessionController.prototype.logout)).toBe(200);
  });

  it('passes bearer credentials to the lifecycle service', async () => {
    const authService = {
      refresh: jest.fn(async (_token: string) => ({ accessToken: 'access' })),
      logout: jest.fn(async (_token: string) => undefined),
      me: jest.fn(async (_token: string) => ({ id: 'user-id' })),
      updateProfile: jest.fn(async (_token: string, _input: unknown) => ({ id: 'user-id' })),
    };
    const controller = new AuthSessionController(authService as never);
    const profileController = new AuthProfileController(authService as never);

    await expect(controller.refresh('Bearer refresh-token')).resolves.toEqual({ accessToken: 'access' });
    await expect(controller.logout('Bearer access-token')).resolves.toBeUndefined();
    await expect(profileController.updateProfile('Bearer access-token', { displayName: 'Ngoc Phat' })).resolves.toEqual({ id: 'user-id' });
    expect(authService.refresh).toHaveBeenCalledWith('refresh-token');
    expect(authService.logout).toHaveBeenCalledWith('access-token');
    expect(authService.updateProfile).toHaveBeenCalledWith('access-token', expect.objectContaining({ displayName: 'Ngoc Phat' }));
  });
});
