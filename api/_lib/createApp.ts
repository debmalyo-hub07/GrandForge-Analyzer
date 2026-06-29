import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

export function createApp() {
  const app = express();
  // Behind Vercel's proxy: trust the first hop so req.ip is the real client IP
  // (correct rate-limit keying + logging) instead of the proxy address, and so
  // express-rate-limit doesn't flag an unexpected X-Forwarded-For header.
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    })
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 150,
    })
  );
  return app;
}
