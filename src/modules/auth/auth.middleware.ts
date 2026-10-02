import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../../config/env';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                role: string;
                token?: string;
            };
        }
    }
}

interface AccessTokenPayload extends JwtPayload {
    sub: string;
    role?: string;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: req.t('auth.tokenNotProvided') });
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: req.t('auth.invalidTokenFormat') });
    }

    if (!env.jwtSecret) {
        console.error('[AuthMiddleware] JWT_SECRET not configured');
        return res.status(500).json({ message: req.t('auth.serverConfigError') });
    }

    try {
        const decoded = jwt.verify(token, env.jwtSecret);

        if (typeof decoded === 'string') {
            return res.status(401).json({ message: req.t('auth.invalidToken') });
        }

        const payload = decoded as AccessTokenPayload;

        if (!payload.sub) {
            return res.status(401).json({ message: req.t('auth.malformedToken') });
        }

        req.user = {
            id: payload.sub,
            role: payload.role ?? 'user',
            token,
        };

        return next();
    } catch (error) {
        console.error('[AuthMiddleware]', error);
        return res.status(401).json({ message: req.t('auth.invalidOrExpiredToken') });
    }
}

export function authorizeRoles(...allowedRoles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: req.t('auth.notAuthenticated') });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: req.t('auth.accessDenied') });
        }

        return next();
    };
}
