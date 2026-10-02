import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildDatabaseUrl } from './config/database';

const connectionString = process.env.DATABASE_URL ?? buildDatabaseUrl();

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });