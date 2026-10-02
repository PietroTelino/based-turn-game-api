/**
 * Precisa ser o PRIMEIRO import dos testes que sobem rotas.
 * Define valores de teste antes de src/config/env.ts ler o ambiente, então os
 * testes rodam sem depender do .env e sem tocar nos segredos de verdade
 * (o dotenv não sobrescreve variáveis que já existem).
 */
process.env.JWT_SECRET = 'segredo-somente-para-testes';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'nao-usado-nos-testes';
process.env.DB_USER = 'nao-usado-nos-testes';
process.env.DB_PASSWORD = 'nao-usado-nos-testes';
