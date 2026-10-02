import { Request, Response } from 'express';
import { PasswordResetService } from './password-reset.service';
import { AuditService } from '../audit/audit.service';

export class PasswordResetController {
    private service = new PasswordResetService();
    private auditService = new AuditService();

    request = async (req: Request, res: Response) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({ message: req.t('password.emailRequired') });
            }

            await this.service.requestReset(email);

            await this.auditService.logPasswordResetRequest(
                email,
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.json({
                message: req.t('password.resetEmailSent'),
            });
        } catch (error: any) {
            console.error(error);
            return res.status(500).json({ message: req.t('password.errorRequest') });
        }
    };

    confirm = async (req: Request, res: Response) => {
        try {
            const { token, password } = req.body;
            if (!token || !password) {
                return res.status(400).json({ message: req.t('password.tokenPasswordRequired') });
            }

            const result = await this.service.resetPassword(token, password);

            if (result) {
                await this.auditService.logPasswordResetConfirm(
                    result.userId,
                    { email: result.email },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.json({ message: req.t('password.resetSuccess') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) });
        }
    };
}