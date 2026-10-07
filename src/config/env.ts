import dotenv from 'dotenv';

dotenv.config();

/**
 * TRUST_PROXY diz ao Express em quantos proxies confiar ao ler o endereço de quem fez a
 * requisição. Aceita um número de saltos (2), "true"/"false" ou uma lista de endereços,
 * como a opção "trust proxy" do Express. Vazio = não confia em nenhum.
 */
function parseTrustProxy(value: string | undefined): number | boolean | string {
    const text = value?.trim() ?? '';

    if (text === '' || text === 'false') return false;
    if (text === 'true') return true;

    return /^\d+$/.test(text) ? Number(text) : text;
}

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

    // Quantos proxies ficam entre o jogador e a API (na AWS: CloudFront + nginx = 2).
    // É o que faz o req.ip ser o endereço do jogador, e não o do proxy.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
};

if (!env.dbHost || !env.dbName || !env.dbUser || !env.dbPassword) {
    throw new Error('Variáveis de banco de dados incompletas no .env');
}
