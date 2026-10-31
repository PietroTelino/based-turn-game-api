import { prisma } from '../../prisma';
import type { User } from '../../generated/prisma/client';

// Os dados de conta de um usuário, sem a senha, as preferências e os números da ranqueada
// (pontos e placar), que têm rota própria em src/modules/ranked, e sem o tutorial feito (rota
// própria em src/modules/tutorial). Numa conta removida, `email` já vem com o e-mail que ela
// tinha (veja softDelete).
export type SafeUser = Omit<User, 'password' | 'preferences' | 'rating' | 'rankedWins' | 'rankedLosses' | 'deletedEmail' | 'tutorialCompletedAt'>;

/** O que a coluna `email` de uma conta removida passa a ter: não é um e-mail, então nunca colide com um. */
function deletedMark(id: string): string {
    return `deleted:${id}`;
}

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
        const rows = await prisma.user.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                deletedEmail: true,
                role: true,
                inactivatedAt: true,
                deletedAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        // Na lista de removidos aparece o e-mail que a conta tinha, não a marca.
        return rows.map(({ deletedEmail, ...user }) => ({ ...user, email: deletedEmail ?? user.email }));
    }

    async findById(id: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { id },
        });
    }

    /** A conta que usa o e-mail agora. Contas removidas não usam mais e-mail nenhum (veja softDelete). */
    async findByEmail(email: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { email },
        });
    }

    /** A conta removida mais recente que usava este e-mail. */
    async findDeletedByEmail(email: string): Promise<User | null> {
        return prisma.user.findFirst({
            where: { deletedEmail: email, deletedAt: { not: null } },
            orderBy: { deletedAt: 'desc' },
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

    /**
     * Remove a conta sem apagar nada: ela some das listas e não entra mais, e
     * o e-mail dela sai da coluna `email` (que é única) para `deletedEmail`.
     * Sem isso, ninguém mais conseguiria se cadastrar com o mesmo e-mail.
     */
    async softDelete(id: string): Promise<User> {
        const user = await prisma.user.findUniqueOrThrow({ where: { id } });

        return prisma.user.update({
            where: { id },
            data: { deletedAt: new Date(), deletedEmail: user.deletedEmail ?? user.email, email: deletedMark(id) },
        });
    }

    /**
     * Devolve a conta removida, com o e-mail que ela tinha. Se alguém já se
     * cadastrou com esse e-mail nesse meio-tempo, não dá: lança user.emailInUse.
     */
    async restore(id: string): Promise<User> {
        const user = await prisma.user.findUniqueOrThrow({ where: { id } });
        const email = user.deletedEmail ?? user.email;
        const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } });

        if (owner && owner.id !== id) {
            throw new Error('user.emailInUse');
        }

        return prisma.user.update({
            where: { id },
            data: { deletedAt: null, deletedEmail: null, email },
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