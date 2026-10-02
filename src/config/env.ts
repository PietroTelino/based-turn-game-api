import dotenv from 'dotenv';

dotenv.config();

export const env = {
    port: Number(process.env.PORT ?? 3333),

    dbHost: process.env.DB_HOST as string,
    dbPort: Number(process.env.DB_PORT ?? 5432),
    dbName: process.env.DB_NAME as string,
    dbUser: process.env.DB_USER as string,
    dbPassword: process.env.DB_PASSWORD as string,

    databaseUrl: process.env.DATABASE_URL,

    jwtSecret: process.env.JWT_SECRET as string,
    jwtExpiresIn: Number(process.env.JWT_EXPIRES_IN_SECONDS) ?? 900,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,
    jwtRefreshExpiresInSeconds: Number(process.env.JWT_REFRESH_EXPIRES_IN_SECONDS) ?? 604800,

    emailEnabled: process.env.EMAIL_ENABLED === 'true',
    emailHost: process.env.EMAIL_HOST,
    emailPort: Number(process.env.EMAIL_PORT ?? 587),
    emailSecure: process.env.EMAIL_SECURE === 'true',
    emailUser: process.env.EMAIL_USER,
    emailPassword: process.env.EMAIL_PASSWORD,
    emailFrom: process.env.EMAIL_FROM ?? 'no-reply@localhost',

    frontendUrl: process.env.FRONTEND_URL,
};

if (!env.dbHost || !env.dbName || !env.dbUser || !env.dbPassword) {
    throw new Error('Variáveis de banco de dados incompletas no .env');
}
