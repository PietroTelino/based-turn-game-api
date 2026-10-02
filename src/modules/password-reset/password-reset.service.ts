import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { UserRepository } from '../users/user.repository';
import { PasswordResetRepository } from './password-reset.repository';
import { EmailService } from '../notifications/email.service';
import { validatePasswordOrThrow } from '../users/policies/password.policy';

export class PasswordResetService {
    private userRepo = new UserRepository();
    private passwordResetRepo = new PasswordResetRepository();
    private emailService = new EmailService();
    private resetTokenExpiresInMs = Number(process.env.PASSWORD_RESET_EXPIRES_MS ?? 1000 * 60 * 60);
    private frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    async requestReset(email: string): Promise<void> {
        const user = await this.userRepo.findByEmail(email);

        if (!user) {
            return;
        }

        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + this.resetTokenExpiresInMs);

        await this.passwordResetRepo.create(user.id, token, expiresAt);

        const resetLink = `${this.frontendUrl}/reset-password?token=${token}`;

        await this.emailService.sendPasswordResetEmail(user.email, resetLink);
    }

    async resetPassword(token: string, newPassword: string): Promise<{ userId: string; email: string } | null> {
        const record = await this.passwordResetRepo.findValidByToken(token);

        if (!record) {
            throw new Error('password.invalidOrExpiredToken');
        }

        validatePasswordOrThrow(newPassword);

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await this.userRepo.updatePassword(record.userId, hashedPassword);
        await this.passwordResetRepo.markAsUsed(record.id);

        return {
            userId: record.user.id,
            email: record.user.email,
        };
    }
}