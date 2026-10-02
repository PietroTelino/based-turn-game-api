import { RefreshTokenRepository } from './tokens/refresh-token.repository';

export class LogoutService {
    constructor(private refreshTokenRepository = new RefreshTokenRepository()) {}

    async execute(refreshToken?: string): Promise<void> {
        if (!refreshToken) return;

        await this.refreshTokenRepository.revoke(refreshToken);
    }

    async logoutAll(userId: string): Promise<void> {
        await this.refreshTokenRepository.revokeAllByUser(userId);
    }
}