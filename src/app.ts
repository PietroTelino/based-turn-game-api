import express from 'express';
import cors from 'cors';
import { router } from './routes';
import { env } from './config/env';
import { i18next, middleware } from './config/i18n';

export const app = express();

app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}));

app.use(middleware.handle(i18next));

app.use(express.json());
app.use('/api', router);