import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';

export class EmailService {
    private transporter: Transporter | null = null;

    constructor() {
        if (!env.emailEnabled) {
            console.warn('[EmailService] Envio de e-mail desabilitado');
            return;
        }

        if (!env.emailHost || !env.emailUser || !env.emailPassword) {
            throw new Error('Configuração de e-mail incompleta no .env');
        }

        this.transporter = nodemailer.createTransport({
            host: env.emailHost,
            port: env.emailPort,
            secure: env.emailSecure,
            auth: {
                user: env.emailUser,
                pass: env.emailPassword,
            },
        });
    }

    async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
        if (!this.transporter) {
            console.log('[EmailService] (DEV MODE)');
            console.log(`To: ${to}`);
            console.log(`Reset link: ${resetLink}`);
            return;
        }

        await this.transporter.sendMail({
            from: env.emailFrom,
            to,
            subject: 'Redefinição de senha',
            html: `
                <p>Você solicitou a redefinição de sua senha.</p>
                <p>Clique no link abaixo para criar uma nova senha:</p>
                <p>
                    <a href="${resetLink}">
                        Redefinir senha
                    </a>
                </p>
                <p>Se você não solicitou isso, ignore este e-mail.</p>
            `,
        });
    }

    async sendPasswordResetByAdminEmail(to: string, newPassword: string): Promise<void> {
        if (!this.transporter) {
            console.log('[EmailService] (DEV MODE)');
            console.log(`To: ${to}`);
            console.log(`Nova senha: ${newPassword}`);
            return;
        }

        await this.transporter.sendMail({
            from: env.emailFrom,
            to,
            subject: 'Sua senha foi resetada',
            html: `
                <p>Sua senha foi resetada por um administrador.</p>
                <p>Sua nova senha temporária é:</p>
                <p style="font-size: 18px; font-weight: bold; background-color: #f0f0f0; padding: 10px; border-radius: 5px; display: inline-block;">
                    ${newPassword}
                </p>
                <p>Por motivos de segurança, recomendamos que você altere esta senha assim que fizer login.</p>
                <p>Se você não solicitou essa alteração, entre em contato com o suporte imediatamente.</p>
            `,
        });
    }
}