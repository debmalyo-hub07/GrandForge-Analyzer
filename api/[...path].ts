/**
 * GrandForge — the single Vercel Serverless Function.
 *
 * A catch-all dynamic route ([...path]) so every /api/* request lands on ONE
 * function, keeping us under Vercel Hobby's 12-function-per-deployment cap. All
 * routing lives in the shared Express app in ./_lib/router.ts (sibling modules
 * under api/_lib/** are excluded from Vercel function detection by the leading
 * underscore, so they don't each become a function).
 */
import app from './_lib/router';

export default app;
