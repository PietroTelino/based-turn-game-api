import { AuditRepository, CreateAuditLogInput } from './audit.repository';

export enum AuditAction {
    USER_REGISTER = 'USER_REGISTER',
    USER_LOGIN = 'USER_LOGIN',
    USER_LOGOUT = 'USER_LOGOUT',
    USER_LOGOUT_ALL = 'USER_LOGOUT_ALL',
    USER_CREATE = 'USER_CREATE',
    USER_UPDATE = 'USER_UPDATE',
    USER_DELETE = 'USER_DELETE',
    USER_SELF_DELETE = 'USER_SELF_DELETE',
    USER_INACTIVATE = 'USER_INACTIVATE',
    USER_REACTIVATE = 'USER_REACTIVATE',
    USER_RESTORE = 'USER_RESTORE',
    USER_HARD_DELETE = 'USER_HARD_DELETE',
    PASSWORD_CHANGE = 'PASSWORD_CHANGE',
    PASSWORD_RESET_REQUEST = 'PASSWORD_RESET_REQUEST',
    PASSWORD_RESET_CONFIRM = 'PASSWORD_RESET_CONFIRM',
    PASSWORD_ADMIN_RESET = 'PASSWORD_ADMIN_RESET',
    PREFERENCES_UPDATE = 'PREFERENCES_UPDATE',
    SESSION_LOGOUT = 'SESSION_LOGOUT',
}

export enum AuditEntity {
    USER = 'USER',
    PASSWORD = 'PASSWORD',
    PREFERENCES = 'PREFERENCES',
    SESSION = 'SESSION',
}

export class AuditService {
    private repo = new AuditRepository();

    async log(input: CreateAuditLogInput): Promise<void> {
        try {
            await this.repo.create(input);
        } catch (error) {
            console.error('[AuditService] Erro ao registrar log de auditoria:', error);
        }
    }

    async logUserRegister(userId: string, details: { email: string }, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.USER_REGISTER,
            entity: AuditEntity.USER,
            entityId: userId,
            details: { email: details.email },
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserLogin(userId: string, details: { email: string }, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.USER_LOGIN,
            entity: AuditEntity.USER,
            entityId: userId,
            details: { email: details.email },
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserLogout(userId: string, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.USER_LOGOUT,
            entity: AuditEntity.SESSION,
            entityId: userId,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserLogoutAll(userId: string, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.USER_LOGOUT_ALL,
            entity: AuditEntity.SESSION,
            entityId: userId,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserCreate(
        targetUserId: string,
        performedById: string,
        details: { email: string; role?: string },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId: targetUserId,
            performedById,
            action: AuditAction.USER_CREATE,
            entity: AuditEntity.USER,
            entityId: targetUserId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserUpdate(
        targetUserId: string,
        performedById: string,
        details: { fields: string[] },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId: targetUserId,
            performedById,
            action: AuditAction.USER_UPDATE,
            entity: AuditEntity.USER,
            entityId: targetUserId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserDelete(
        targetUserId: string,
        performedById: string,
        details: { email: string },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId: targetUserId,
            performedById,
            action: AuditAction.USER_DELETE,
            entity: AuditEntity.USER,
            entityId: targetUserId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserSelfDelete(userId: string, details: { email: string }, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.USER_SELF_DELETE,
            entity: AuditEntity.USER,
            entityId: userId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserInactivate(
        targetUserId: string,
        performedById: string,
        details: { email: string },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId: targetUserId,
            performedById,
            action: AuditAction.USER_INACTIVATE,
            entity: AuditEntity.USER,
            entityId: targetUserId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logUserReactivate(
        targetUserId: string,
        performedById: string,
        details: { email: string },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId: targetUserId,
            performedById,
            action: AuditAction.USER_REACTIVATE,
            entity: AuditEntity.USER,
            entityId: targetUserId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logPasswordChange(userId: string, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.PASSWORD_CHANGE,
            entity: AuditEntity.PASSWORD,
            entityId: userId,
            details: { message: 'Senha alterada pelo próprio usuário' },
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logPasswordResetRequest(email: string, ip?: string, userAgent?: string) {
        await this.log({
            action: AuditAction.PASSWORD_RESET_REQUEST,
            entity: AuditEntity.PASSWORD,
            details: { email },
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logPasswordResetConfirm(userId: string, details: { email: string }, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.PASSWORD_RESET_CONFIRM,
            entity: AuditEntity.PASSWORD,
            entityId: userId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logPasswordAdminReset(
        targetUserId: string,
        performedById: string,
        details: { email: string },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId: targetUserId,
            performedById,
            action: AuditAction.PASSWORD_ADMIN_RESET,
            entity: AuditEntity.PASSWORD,
            entityId: targetUserId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logPreferencesUpdate(
        userId: string,
        details: { preferences: any },
        ip?: string,
        userAgent?: string
    ) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.PREFERENCES_UPDATE,
            entity: AuditEntity.PREFERENCES,
            entityId: userId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async logSessionLogout(userId: string, details: { sessionId: string }, ip?: string, userAgent?: string) {
        await this.log({
            userId,
            performedById: userId,
            action: AuditAction.SESSION_LOGOUT,
            entity: AuditEntity.SESSION,
            entityId: userId,
            details,
            ...(ip && { ipAddress: ip }),
            ...(userAgent && { userAgent }),
        });
    }

    async list(options?: {
        userId?: string;
        performedById?: string;
        action?: string;
        entity?: string;
        limit?: number;
        offset?: number;
    }) {
        return this.repo.findAll(options);
    }

    async getById(id: string) {
        return this.repo.findById(id);
    }

    async count(options?: {
        userId?: string;
        performedById?: string;
        action?: string;
        entity?: string;
    }) {
        return this.repo.count(options);
    }
}