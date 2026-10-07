import express from 'express';
import cors from 'cors';
import { router } from './routes';
import { env } from './config/env';
import { i18next, middleware } from './config/i18n';

export const app = express();

// Atrás de um proxy (nginx, CloudFront), é isto que faz o req.ip ser o endereço de quem
// fez a requisição. Sem TRUST_PROXY no ambiente fica desligado, como sempre foi.
app.set('trust proxy', env.trustProxy);

app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}));

app.use(middleware.handle(i18next));

app.use(express.json());
app.use('/api', router);