/**
 * Types for `api/_bundle.js`, the generated esbuild output that the serverless
 * entry point imports. The .js file is build output and is gitignored, so
 * without this declaration `tsc` would fail on a missing module during
 * `npm run build` — on a clean checkout the bundle does not exist yet.
 *
 * Two Vercel conventions make this file safe to sit in `api/`: names starting
 * with `_` and names ending in `.d.ts` are both excluded from function
 * detection, so this consumes none of the Hobby 12-function budget.
 */
import type { Express } from 'express';

declare const app: Express;
export default app;
