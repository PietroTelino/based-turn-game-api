import jwt from 'jsonwebtoken';
import { prisma } from '../../../prisma';
import { env } from '../../../config/env';

interface RefreshTokenPayload {
    accessToken: string;
}

export class RefreshTokenService {
    async execute(token: string): Promise<RefreshTokenPayload> {
        if (!token) {
            throw new Error('Refresh token não informado');
        }

        const refreshToken = await prisma.refreshToken.findUnique({
            where: { token },
            include: { user: true },
        });

        if (!refreshToken) {
            throw new Error('Refresh token inválido');
        }

        if (refreshToken.revoked) {
            throw new Error('Refresh token revogado');
        }

        if (refreshToken.expiresAt < new Date()) {
            throw new Error('Refresh token expirado');
        }

        const accessToken = jwt.sign(
            {
                role: refreshToken.user.role,
            },
            env.jwtSecret,
            {
                subject: refreshToken.user.id,
                expiresIn: env.jwtExpiresIn,
            }
        );

        return {
            accessToken,
        };
    }
}
