import { t } from '../../../utils/t';

export function validateEmailOrThrow(email: string): void {
    if (typeof email !== 'string') {
        throw new Error(t('email.mustBeText'));
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
        throw new Error(t('email.required'));
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(normalizedEmail)) {
        throw new Error(t('email.invalidFormat'));
    }
}