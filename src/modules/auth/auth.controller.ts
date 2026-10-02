import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LogoutService } from './logout.service';
import { AuditService } from '../audit/audit.service';

export class AuthController {
    private service = new AuthService();
    private auditService = new AuditService();

    login = async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ message: req.t('auth.emailPasswordRequired') });
            }

            const result = await this.service.login({
                email,
                password,
                ...(req.ip && { ip: req.ip }),
                ...(typeof req.headers['user-agent'] === 'string' && {
                    userAgent: req.headers['user-agent'],
                }),
            });

            await this.auditService.logUserLogin(
                result.user.id,
                { email: result.user.email },
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.json(result);
        } catch (error: any) {
            return res.status(401).json({ message: req.t(error.message) });
        }
    };

    refresh = async (req: Request, res: Response) => {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({ message: req.t('auth.refreshTokenRequired') });
            }

            const result = await this.service.refresh(refreshToken);
            return res.json(result);
        } catch (error: any) {
            return res.status(401).json({ message: req.t(error.message) });
        }
    };

    logout = async (req: Request, res: Response) => {
        const refreshToken = req.body.refreshToken || req.cookies?.refreshToken || req.headers['x-refresh-token'];
        const service = new LogoutService();
        await service.execute(refreshToken);

        res.clearCookie('refreshToken');

        if (req.user) {
            await this.auditService.logUserLogout(
                req.user.id,
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );
        }

        return res.status(204).send();
    };

    logoutAll = async (req: Request, res: Response) => {
        if (!req.user) {
            return res.status(401).json({ message: req.t('auth.notAuthenticated') });
        }

        const service = new LogoutService();
        await service.logoutAll(req.user.id);

        await this.auditService.logUserLogoutAll(
            req.user.id,
            req.ip,
            typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
        );

        return res.status(204).send();
    };
}