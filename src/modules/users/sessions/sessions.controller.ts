import { Request, Response } from 'express';
import { SessionService } from './sessions.service';
import { AuditService } from '../../audit/audit.service';

export class SessionController {
    private service = new SessionService();
    private auditService = new AuditService();

    listMySessions = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const sessions = await this.service.listMySessions(req.user.id);
            return res.json(sessions);
        } catch (error: any) {
            return res.status(401).json({ message: req.t(error.message) });
        }
    };

    logoutSession = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { sessionId } = req.params;

            if (!sessionId) {
                return res.status(400).json({ message: req.t('user.sessionRequired') });
            }

            await this.service.logoutSession(req.user.id, sessionId);

            await this.auditService.logSessionLogout(
                req.user.id,
                { sessionId },
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.status(200).json({ message: req.t('user.sessionTerminated') });
        } catch (error: any) {
            return res.status(401).json({ message: req.t(error.message) });
        }
    };
}