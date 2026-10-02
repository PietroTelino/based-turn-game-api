import { prisma } from '../../prisma';
import type { PasswordReset, User } from '../../generated/prisma/client';

export class PasswordResetRepository {
    async create(userId: string, token: string, expiresAt: Date): Promise<PasswordReset> {
        return prisma.passwordReset.create({
            data: {
                userId,
                token,
                expiresAt,
            },
        });
    }

    async findValidByToken(token: string): Promise<(PasswordReset & { user: User }) | null> {
        const now = new Date();

        return prisma.passwordReset.findFirst({
            where: {
                token,
                expiresAt: { gt: now },
                usedAt: null,
            },
            include: {
                user: true,
            },
        });
    }

    async markAsUsed(id: string): Promise<void> {
        await prisma.passwordReset.update({
            where: { id },
            data: { usedAt: new Date() },
        });
    }
}