import { prisma } from '../../prisma';
import type { User } from '../../generated/prisma/client';

export type SafeUser = Omit<User, 'password' | 'preferences'>;

export class UserRepository {
    async findAll(): Promise<SafeUser[]> {
        return prisma.user.findMany({
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                inactivatedAt: true,
                deletedAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    async findAllDeleted(): Promise<SafeUser[]> {
        return prisma.user.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                inactivatedAt: true,
                deletedAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    async findById(id: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { id },
        });
    }

    async findByEmail(email: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { email },
        });
    }

    async create(data: {
        name: string;
        email: string;
        password: string;
        role?: string;
        preferences?: any;
    }): Promise<User> {
        return prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: data.password,
                role: data.role ?? 'user',
                preferences: data.preferences ?? null,
            },
        });
    }

    async update(id: string, data: { name?: string; email?: string }): Promise<User> {
        return prisma.user.update({
            where: { id },
            data,
        });
    }

    async delete(id: string): Promise<void> {
        await prisma.user.delete({
            where: { id },
        });
    }

    async softDelete(id: string): Promise<User> {
        return prisma.user.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }

    async restore(id: string): Promise<User> {
        return prisma.user.update({
            where: { id },
            data: { deletedAt: null },
        });
    }

    async hardDelete(id: string): Promise<void> {
        await prisma.user.delete({
            where: { id },
        });
    }

    async updatePassword(id: string, hashedPassword: string): Promise<User> {
        return prisma.user.update({
            where: { id },
            data: { password: hashedPassword },
        });
    }

    async updatePreferences(id: string, preferences: any): Promise<User> {
        return prisma.user.update({
            where: { id },
            data: { preferences },
        });
    }

    async inactivate(id: string): Promise<User> {
        return prisma.user.update({
            where: { id },
            data: { inactivatedAt: new Date() },
        });
    }

    async reactivate(id: string): Promise<User> {
        return prisma.user.update({
            where: { id },
            data: { inactivatedAt: null },
        });
    }
}