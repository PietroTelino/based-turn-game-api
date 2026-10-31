import type { TutorialStore } from '../tutorial.service';

/** Faz o papel da coluna users.tutorial_completed_at nos testes. */
export class InMemoryTutorialStore implements TutorialStore {
    private done = new Map<string, Date>();

    async completedAt(userId: string): Promise<Date | null> {
        return this.done.get(userId) ?? null;
    }

    async markCompleted(userId: string, at: Date): Promise<void> {
        if (!this.done.has(userId)) this.done.set(userId, at);
    }
}
