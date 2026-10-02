import { prisma } from '../../prisma';
import type { AuditLog, Prisma } from '../../generated/prisma/client';

export interface CreateAuditLogInput {
    userId?: string;
    performedById?: string;
    action: string;
    entity: string;
    entityId?: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
}

export class AuditRepository {
    async create(input: CreateAuditLogInput): Promise<AuditLog> {
        const data: Prisma.AuditLogCreateInput = {
            action: input.action,
            entity: input.entity,
            ...(input.userId && { userId: input.userId }),
            ...(input.performedById && { performedById: input.performedById }),
            ...(input.entityId && { entityId: input.entityId }),
            ...(input.details && { details: input.details }),
            ...(input.ipAddress && { ipAddress: input.ipAddress }),
            ...(input.userAgent && { userAgent: input.userAgent }),
        };

        return prisma.auditLog.create({ data });
    }

    async findAll(options?: {
        userId?: string;
        performedById?: string;
        action?: string;
        entity?: string;
        limit?: number;
        offset?: number;
    }) {
        const { userId, performedById, action, entity, limit = 100, offset = 0 } = options || {};

        return prisma.auditLog.findMany({
            where: {
                ...(userId && { userId }),
                ...(performedById && { performedById }),
                ...(action && { action }),
                ...(entity && { entity }),
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
                performedBy: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
            take: limit,
            skip: offset,
        });
    }

    async findById(id: string): Promise<AuditLog | null> {
        return prisma.auditLog.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
                performedBy: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
            },
        });
    }

    async count(options?: {
        userId?: string;
        performedById?: string;
        action?: string;
        entity?: string;
    }): Promise<number> {
        const { userId, performedById, action, entity } = options || {};

        return prisma.auditLog.count({
            where: {
                ...(userId && { userId }),
                ...(performedById && { performedById }),
                ...(action && { action }),
                ...(entity && { entity }),
            },
        });
    }
}