import { env } from './env';

export function buildDatabaseUrl(): string {
    const {
        dbHost,
        dbPort,
        dbName,
        dbUser,
        dbPassword,
    } = env;

    return `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}?schema=public`;
}
