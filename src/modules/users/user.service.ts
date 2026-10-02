import { UserRepository, SafeUser } from './user.repository';
import type { User } from '../../generated/prisma/client';
import bcrypt from 'bcrypt';
import { validatePasswordOrThrow } from './policies/password.policy';
import { validateEmailOrThrow } from './policies/email.policy';
import { RefreshTokenRepository } from '../auth/tokens/refresh-token.repository';
import { EmailService } from '../notifications/email.service';

type Theme = 'light' | 'dark';

export class UserService {
    private repo = new UserRepository();
    private emailService = new EmailService();

    async register(input: { name: string; email: string; password: string; preferences?: any }) {
        validateEmailOrThrow(input.email);
        validatePasswordOrThrow(input.password);

        const exists = await this.repo.findByEmail(input.email);
        if (exists) {
            throw new Error('user.emailInUse');
        }

        const hashedPassword = await bcrypt.hash(input.password, 10);
        const user = await this.repo.create({
            ...input,
            password: hashedPassword,
        });

        return {
            id: user.id,
            email: user.email,
            createdAt: user.createdAt,
        };
    }

    list(): Promise<SafeUser[]> {
        return this.repo.findAll();
    }

    listDeleted(): Promise<SafeUser[]> {
        return this.repo.findAllDeleted();
    }

    getById(id: string): Promise<User | null> {
        return this.repo.findById(id);
    }

    async create(input: { name: string; email: string; password: string; role?: string; preferences?: any }): Promise<User> {
        if (!input.name || !input.email) {
            throw new Error('user.fieldRequired');
        }

        validateEmailOrThrow(input.email);
        validatePasswordOrThrow(input.password);

        const hashedPassword = await bcrypt.hash(input.password, 10);

        return this.repo.create({
            ...input,
            password: hashedPassword,
        });
    }

    update(id: string, input: { name?: string; email?: string }): Promise<User> {
        if (input.email) {
            validateEmailOrThrow(input.email);
            input.email = input.email.trim().toLowerCase();
        }

        return this.repo.update(id, input);
    }

    async changeMyPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
        const user = await this.repo.findById(userId);

        if (!user) {
            throw new Error('user.notFound');
        }

        const passwordMatches = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatches) {
            throw new Error('user.currentPasswordWrong');
        }

        validatePasswordOrThrow(newPassword);

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await this.repo.updatePassword(userId, hashedPassword);

        const refreshTokenRepo = new RefreshTokenRepository();
        await refreshTokenRepo.revokeAllByUser(userId);
    }

    async selfDelete(id: string, password: string): Promise<void> {
        const user = await this.getById(id);

        if (!user) {
            throw new Error('auth.notAuthenticated');
        }

        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            throw new Error('user.incorrectPassword');
        }

        await this.repo.softDelete(id);

        const refreshTokenRepo = new RefreshTokenRepository();
        await refreshTokenRepo.revokeAllByUser(id);
    }

    async delete(id: string): Promise<void> {
        const user = await this.repo.findById(id);

        if (!user) {
            throw new Error('user.notFound');
        }

        if (user.deletedAt) {
            throw new Error('user.alreadyDeleted');
        }

        return this.repo.softDelete(id).then(() => {
            const refreshTokenRepo = new RefreshTokenRepository();
            return refreshTokenRepo.revokeAllByUser(id);
        });
    }

    async restore(id: string): Promise<void> {
        const user = await this.repo.findById(id);

        if (!user) {
            throw new Error('user.notFound');
        }

        if (!user.deletedAt) {
            throw new Error('user.notDeleted');
        }

        await this.repo.restore(id);
    }

    async hardDelete(id: string): Promise<void> {
        const user = await this.repo.findById(id);

        if (!user) {
            throw new Error('user.notFound');
        }

        if (user.role === 'god') {
            throw new Error('user.cannotDeleteGod');
        }

        const refreshTokenRepo = new RefreshTokenRepository();
        await refreshTokenRepo.revokeAllByUser(id);

        await this.repo.hardDelete(id);
    }

    async updateMyTheme(id: string, theme: Theme): Promise<{ preferences: { theme: Theme } }> {
        if (theme !== 'light' && theme !== 'dark') {
            throw new Error('user.invalidTheme');
        }

        const user = await this.repo.findById(id);

        if (!user) {
            throw new Error('user.notFound');
        }

        const currentPrefs = (user.preferences ?? {}) as Record<string, any>;

        const newPreferences = {
            ...currentPrefs,
            theme,
        };

        await this.repo.updatePreferences(id, newPreferences);

        return { preferences: { theme } };
    }

    async inactivateUser(targetUserId: string): Promise<void> {
        const user = await this.repo.findById(targetUserId);

        if (!user) {
            throw new Error('user.notFound');
        }

        if (user.role === 'god') {
            throw new Error('user.cannotInactivateGod');
        }

        if (user.inactivatedAt) {
            throw new Error('user.alreadyInactive');
        }

        await this.repo.inactivate(targetUserId);

        const refreshTokenRepo = new RefreshTokenRepository();
        await refreshTokenRepo.revokeAllByUser(targetUserId);
    }

    async reactivateUser(targetUserId: string): Promise<void> {
        const user = await this.repo.findById(targetUserId);

        if (!user) {
            throw new Error('user.notFound');
        }

        if (!user.inactivatedAt) {
            throw new Error('user.alreadyActive');
        }

        await this.repo.reactivate(targetUserId);
    }

    private generateRandomPassword(): string {
        const length = 8;
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const specialChars = '!@#$%&*()_+=-[]{}|;:,.<>?';

        let password = '';
        password += specialChars[Math.floor(Math.random() * specialChars.length)];
        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];

        const allChars = lowercase + uppercase + numbers + specialChars;

        for (let i = password.length; i < length; i++) {
            password += allChars[Math.floor(Math.random() * allChars.length)];
        }

        return password.split('').sort(() => Math.random() - 0.5).join('');
    }

    async adminResetPassword(targetUserId: string): Promise<void> {
        const user = await this.repo.findById(targetUserId);

        if (!user) {
            throw new Error('user.notFound');
        }

        if (user.role === 'god') {
            throw new Error('user.cannotResetGodPassword');
        }

        const newPassword = this.generateRandomPassword();
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await this.repo.updatePassword(targetUserId, hashedPassword);

        const refreshTokenRepo = new RefreshTokenRepository();
        await refreshTokenRepo.revokeAllByUser(targetUserId);

        await this.emailService.sendPasswordResetByAdminEmail(user.email, newPassword);
    }
}