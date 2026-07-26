/**
 * GrandForge — the single Vercel Serverless Function (fallback API deploy).
 *
 * A catch-all dynamic route ([...path]) so every /api/* request lands on ONE
 * function, keeping us under Vercel Hobby's 12-function-per-deployment cap.
 * This file exists ONLY to satisfy Vercel's root-`api/` functions convention;
 * the real backend lives in backend/ (router.ts + routes/**) and is primarily
 * deployed as a persistent server on Render (backend/index.ts, render.yaml).
 * `vercel.json` sets `includeFiles: "backend/**"` so the bundled function can
 * resolve this import at runtime.
 */
import app from '../backend/router';

export default app;
