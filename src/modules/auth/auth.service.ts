import bcrypt from 'bcrypt';
import jwt, { SignOptions, JwtPayload } from 'jsonwebtoken';
import { UserRepository } from '../users/user.repository';
import { RefreshTokenRepository } from './tokens/refresh-token.repository';
import type { User } from '../../generated/prisma/client';

interface LoginInput {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
}

interface AuthResponse {
    user: Omit<User, 'password'>;
    accessToken: string;
    refreshToken: string;
}

export class AuthService {
    private userRepo = new UserRepository();
    private refreshTokenRepo = new RefreshTokenRepository();
    private accessSecret = process.env.JWT_SECRET!;
    private refreshSecret = process.env.JWT_REFRESH_SECRET!;
    private accessExpiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 900);
    private refreshExpiresInSeconds = Number(
        process.env.JWT_REFRESH_EXPIRES_IN_SECONDS ?? 60 * 60 * 24 * 7
    );

    private generateAccessToken(user: User): string {
        return jwt.sign(
            { sub: user.id, role: user.role },
            this.accessSecret,
            { expiresIn: this.accessExpiresInSeconds }
        );
    }

    private generateRefreshToken(user: User): string {
        return jwt.sign(
            { sub: user.id },
            this.refreshSecret,
            { expiresIn: this.refreshExpiresInSeconds }
        );
    }

    async login({ email, password, ip, userAgent }: LoginInput): Promise<AuthResponse> {
        const user = await this.userRepo.findByEmail(email);
        
        if (!user || !(await bcrypt.compare(password, user.password))) {
            throw new Error('auth.invalidCredentials');
        }

        if (user.deletedAt) {
            throw new Error('auth.accountDeleted');
        }

        if (user.inactivatedAt) {
            throw new Error('auth.accountInactive');
        }

        const accessToken = this.generateAccessToken(user);
        const refreshToken = this.generateRefreshToken(user);

        await this.refreshTokenRepo.create({
            userId: user.id,
            token: refreshToken,
            expiresAt: new Date(
                Date.now() + this.refreshExpiresInSeconds * 1000
            ),
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });

        const { password: _, ...userWithoutPassword } = user;

        return {
            user: userWithoutPassword,
            accessToken,
            refreshToken,
        };
    }

    async refresh(refreshToken: string): Promise<AuthResponse> {
        if (!refreshToken) {
            throw new Error('auth.refreshTokenNotProvided');
        }

        let payload: JwtPayload;

        try {
            payload = jwt.verify(refreshToken, this.refreshSecret) as JwtPayload;
        } catch {
            throw new Error('auth.refreshTokenInvalidOrExpired');
        }

        if (!payload.sub) {
            throw new Error('auth.refreshTokenMalformed');
        }

        const tokenRecord = await this.refreshTokenRepo.findByToken(refreshToken);
        if (
            !tokenRecord ||
            tokenRecord.revoked ||
            tokenRecord.expiresAt < new Date()
        ) {
            throw new Error('auth.refreshTokenInvalid');
        }

        const user = await this.userRepo.findById(String(payload.sub));

        if (!user) {
            throw new Error('user.notFound');
        }

        if (user.deletedAt) {
            throw new Error('user.accountDeleted');
        }

        if (user.inactivatedAt) {
            throw new Error('auth.accountInactive');
        }

        await this.refreshTokenRepo.revoke(refreshToken);

        const newAccessToken = this.generateAccessToken(user);
        const newRefreshToken = this.generateRefreshToken(user);

        await this.refreshTokenRepo.create({
            userId: user.id,
            token: newRefreshToken,
            expiresAt: new Date(Date.now() + this.refreshExpiresInSeconds * 1000),
        });

        const { password: _, ...userWithoutPassword } = user;

        return {
            user: userWithoutPassword,
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };
    }
}