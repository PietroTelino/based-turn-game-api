import { i18next } from '../config/i18n';

export function t(key: string, options?: object): string {
    return i18next.t(key, options as any) as string;
};