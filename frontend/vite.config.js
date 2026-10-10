import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";

// Vercel serves the functions in api/ in production. This does the same for
// the dev server, so `npm run dev` has a working /api without `vercel dev`.
function devApi() {
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([\w-]+)(?:\?|$)/);
        if (!match) return next();
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const text = Buffer.concat(chunks).toString();
          req.body = text ? JSON.parse(text) : {};
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (data) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(data));
          };
          const { default: handler } = await server.ssrLoadModule(`/api/${match[1]}.js`);
          await handler(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-only secrets (.env.local) reach the API functions through
  // process.env, as they do on Vercel. Only VITE_ variables reach the browser.
  // The keeper wallet's key lives in the repo root's .env.
  Object.assign(process.env, loadEnv(mode, path.resolve(process.cwd(), ".."), ""), loadEnv(mode, process.cwd(), ""));
  return {
    plugins: [react(), devApi()],
    server: {
      port: 5173,
    },
  };
});
