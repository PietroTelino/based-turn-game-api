import { t } from '../../../utils/t';

export function validatePasswordOrThrow(password: string): void {
    if (typeof password !== 'string') {
        throw new Error(t('password.mustBeText'));
    }

    if (password.length < 8) {
        throw new Error(t('password.minLength'));
    }

    const hasSpecialChar = /[^a-zA-Z0-9]/.test(password);

    if (!hasSpecialChar) {
        throw new Error(t('password.specialChar'));
    }
}