import express from 'express';
import { registerCoreRoutes } from './routesCore.ts';
import { registerMediaRoutes } from './routesMedia.ts';

export const PORT = Number(process.env.PORT) || 3000;
export const isProduction = process.env.NODE_ENV === 'production';

export const app = express();
app.set('trust proxy', true);

registerCoreRoutes(app);
registerMediaRoutes(app);

export default app;
