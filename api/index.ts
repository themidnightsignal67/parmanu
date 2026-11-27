/**
 * Vercel serverless entrypoint.
 * Routes all traffic (API + SPA) through the Express app in server.ts.
 */
import app from '../server.ts';

export default app;
