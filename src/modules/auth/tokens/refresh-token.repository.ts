import { RefreshToken } from '../../../generated/prisma/client';
import { prisma } from '../../../prisma';

export class RefreshTokenRepository {
    create(data: {
        userId: string;
        token: string;
        expiresAt: Date;
        ipAddress?: string;
        userAgent?: string;
    }) {
        return prisma.refreshToken.create({
            data,
        });
    }


    async findByToken(token: string): Promise<RefreshToken | null> {
        return prisma.refreshToken.findUnique({
            where: { token },
        });
    }

    async findActiveByUser(userId: string) {
        const now = new Date();

        return prisma.refreshToken.findMany({
            where: {
                userId,
                revoked: false,
                expiresAt: { gt: now },
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                createdAt: true,
                expiresAt: true,
                userAgent: true,
                ipAddress: true,
            },
        });
    }

    async revoke(token: string): Promise<void> {
        await prisma.refreshToken.updateMany({
            where: {
                token,
                revoked: false,
            },
            data: {
                revoked: true,
            },
        });
    }

    async revokeById(id: string): Promise<void> {
        await prisma.refreshToken.update({
            where: { id },
            data: { revoked: true },
        });
    }

    async revokeAllByUser(userId: string): Promise<void> {
        await prisma.refreshToken.updateMany({
            where: {
                userId,
                revoked: false,
            },
            data: {
                revoked: true,
            },
        });
    }
}
