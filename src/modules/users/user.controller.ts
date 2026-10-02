import { Request, Response } from 'express';
import { UserService } from './user.service';
import { AuditService } from '../audit/audit.service';

export class UserController {
    private service = new UserService();
    private auditService = new AuditService();

    register = async (req: Request, res: Response) => {
        try {
            const { name, email, password, preferences } = req.body;

            if (!name || !email || !password) {
                return res.status(400).json({ message: req.t('user.fieldRequired') });
            }

            const user = await this.service.register({ name, email, password, preferences });

            await this.auditService.logUserRegister(
                user.id,
                { email: user.email },
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.status(201).json(user);
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorRegister') });
        }
    };

    list = async (req: Request, res: Response) => {
        try {
            const users = await this.service.list();
            return res.json(users);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: req.t('user.errorList') });
        }
    };

    listDeleted = async (req: Request, res: Response) => {
        try {
            const users = await this.service.listDeleted();
            return res.json(users);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: req.t('user.errorListDeleted') });
        }
    };

    getById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const user = await this.service.getById(id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            return res.json(user);
        } catch (err) {
            console.error(err);
            return res.status(500).json({ message: req.t('user.errorFind') });
        }
    };

    create = async (req: Request, res: Response) => {
        try {
            const { name, email, password, role, preferences } = req.body;

            if (!name || !email || !password) {
                return res.status(400).json({ message: req.t('user.fieldRequired') });
            }

            const user = await this.service.create({ name, email, password, role, preferences });

            if (req.user) {
                await this.auditService.logUserCreate(
                    user.id,
                    req.user.id,
                    { email: user.email, role: user.role },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.status(201).json(user);
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorCreate') });
        }
    };

    update = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const { name, email } = req.body;
            const fields = [];
            if (name) fields.push('name');
            if (email) fields.push('email');

            const user = await this.service.update(id, { name, email });

            if (req.user) {
                await this.auditService.logUserUpdate(
                    id,
                    req.user.id,
                    { fields },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.json(user);
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorUpdate') });
        }
    };

    changeMyPassword = async (req: Request, res: Response) => {
        try {
            const { currentPassword, newPassword } = req.body;

            if (!req.user || !currentPassword || !newPassword) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            await this.service.changeMyPassword(req.user.id, currentPassword, newPassword);

            await this.auditService.logPasswordChange(
                req.user.id,
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.status(200).json({ message: req.t('user.passwordChanged') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorChangePassword') });
        }
    };

    selfDelete = async (req: Request, res: Response) => {
        try {
            const { password } = req.body;

            if (!req.user || !password) {
                return res.status(401).json({ message: req.t('user.notFound') });
            }

            const user = await this.service.getById(req.user.id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            await this.service.selfDelete(req.user.id, password);

            await this.auditService.logUserSelfDelete(
                req.user.id,
                { email: user.email },
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.status(200).json({ message: req.t('user.accountRemoved') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorDelete') });
        }
    };

    delete = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const user = await this.service.getById(id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            await this.service.delete(id);

            if (req.user) {
                await this.auditService.logUserDelete(
                    id,
                    req.user.id,
                    { email: user.email },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.status(200).json({ message: req.t('user.accountRemoved') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorDelete') });
        }
    };

    updateMyPreferences = async (req: Request, res: Response) => {
        try {
            if (!req.user) {
                return res.status(401).json({ message: req.t('auth.notAuthenticated') });
            }

            const { theme } = req.body;

            if (!theme) {
                return res.status(400).json({ message: req.t('user.themeRequired') });
            }

            const result = await this.service.updateMyTheme(req.user.id, theme);

            await this.auditService.logPreferencesUpdate(
                req.user.id,
                { preferences: { theme } },
                req.ip,
                typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
            );

            return res.json(result);
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorPreferences') });
        }
    };

    inactivateUser = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const user = await this.service.getById(id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            await this.service.inactivateUser(id);

            if (req.user) {
                await this.auditService.logUserInactivate(
                    id,
                    req.user.id,
                    { email: user.email },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.status(200).json({ message: req.t('user.inactivated') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorInactivate') });
        }
    };

    reactivateUser = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const user = await this.service.getById(id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            await this.service.reactivateUser(id);

            if (req.user) {
                await this.auditService.logUserReactivate(
                    id,
                    req.user.id,
                    { email: user.email },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.status(200).json({ message: req.t('user.reactivated') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorReactivate') });
        }
    };

    adminResetPassword = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const user = await this.service.getById(id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            await this.service.adminResetPassword(id);

            if (req.user) {
                await this.auditService.logPasswordAdminReset(
                    id,
                    req.user.id,
                    { email: user.email },
                    req.ip,
                    typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined
                );
            }

            return res.status(200).json({
                message: req.t('user.passwordReset'),
            });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorResetPassword') });
        }
    };

    restoreUser = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            await this.service.restore(id);

            if (req.user) {
                const user = await this.service.getById(id);

                if (user) {
                    await this.auditService.log({
                        userId: id,
                        performedById: req.user.id,
                        action: 'USER_RESTORE',
                        entity: 'USER',
                        entityId: id,
                        details: { email: user.email },
                        ...(req.ip && { ipAddress: req.ip }),
                        ...(typeof req.headers['user-agent'] === 'string' && { userAgent: req.headers['user-agent'] }),
                    });
                }
            }

            return res.status(200).json({ message: req.t('user.restored') });
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorRestore') });
        }
    };

    hardDelete = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: req.t('user.idRequired') });
            }

            const user = await this.service.getById(id);

            if (!user) {
                return res.status(404).json({ message: req.t('user.notFound') });
            }

            await this.service.hardDelete(id);

            if (req.user) {
                await this.auditService.log({
                    userId: id,
                    performedById: req.user.id,
                    action: 'USER_HARD_DELETE',
                    entity: 'USER',
                    entityId: id,
                    details: { email: user.email },
                    ...(req.ip && { ipAddress: req.ip }),
                    ...(typeof req.headers['user-agent'] === 'string' && { userAgent: req.headers['user-agent'] }),
                });
            }

            return res.status(204).send();
        } catch (error: any) {
            console.error(error);
            return res.status(400).json({ message: req.t(error.message) || req.t('user.errorHardDelete') });
        }
    };
}