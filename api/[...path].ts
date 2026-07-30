/**
 * GrandForge — the single Vercel Serverless Function (fallback API deploy).
 *
 * A catch-all dynamic route ([...path]) so every /api/* request lands on ONE
 * function, keeping us under Vercel Hobby's 12-function-per-deployment cap.
 * This file exists ONLY to satisfy Vercel's root-`api/` functions convention;
 * the real backend lives in backend/ (router.ts + routes/**) and is primarily
 * deployed as a persistent server on Render (backend/index.ts, render.yaml).
 *
 * It imports the PRE-BUNDLED `./_bundle.js` rather than `../backend/router`
 * directly. That indirection is the fix for a hard runtime failure:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/backend/router'
 *
 * `@vercel/node` traces imports instead of bundling them, so the old relative
 * import survived into the deployed output pointing at TypeScript sources Node
 * cannot load (and extensionless, which ESM will not resolve regardless).
 * `scripts/buildVercelFunction.mjs` inlines the whole backend into
 * `api/_bundle.js` during the build, leaving nothing to resolve at runtime.
 */
import app from './_bundle.js';

export default app;
