/**
 * Local API dev server. Imports the SAME consolidated Express app that the
 * production serverless function (api/[...path].ts) re-exports, and only adds
 * .listen() — so local `npm run dev` and Vercel prod run one identical routing
 * table (api/_lib/router.ts). The Vite dev proxy targets this port.
 */
import app from '../api/_lib/router';

const port = Number(process.env.API_PORT ?? 3000);

app.listen(port, () => {
  console.log(`GrandForge API dev server ready at http://localhost:${port}`);
});
