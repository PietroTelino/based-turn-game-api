import { prisma } from '../../prisma';
import type { TutorialStore } from './tutorial.service';

/** O tutorial feito fica numa coluna do usuário: users.tutorial_completed_at. */
export class TutorialRepository implements TutorialStore {
    async completedAt(userId: string): Promise<Date | null> {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { tutorialCompletedAt: true } });

        return user?.tutorialCompletedAt ?? null;
    }

    async markCompleted(userId: string, at: Date): Promise<void> {
        // Só a primeira vez conta: refazer o treino não muda a data.
        await prisma.user.updateMany({ where: { id: userId, tutorialCompletedAt: null }, data: { tutorialCompletedAt: at } });
    }
}
