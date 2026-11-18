import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';

const app = new Hono();

// CORS middleware
app.use(
  '*',
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

// Logger middleware
app.use('*', logger());

// Health check route (stub for now)
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    mode: 'normal',
    budget: {
      dailyBudgetCents: 500,
      spentCents: 0,
      remainingCents: 500,
    },
  });
});

export default app;
