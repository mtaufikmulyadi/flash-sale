/**
 * Fastify app factory
 *
 * buildApp() creates and configures the Fastify instance.
 * Kept separate from server.ts so integration tests can
 * import buildApp() without starting a real TCP listener.
 */

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import saleRoutes     from "./routes/sale";
import purchaseRoutes from "./routes/purchase";
import authRoutes     from "./routes/auth";
import adminRoutes    from "./routes/admin";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  // ── Decorate request with userId before any routes register ───
  // Routes use this via the authenticate preHandler
  app.decorateRequest("userId", "");

  // ── CORS ──────────────────────────────────────────────────────
  await app.register(cors, {
    origin:  process.env.FRONTEND_URL ?? "http://localhost:5173",
    methods: ["GET", "POST"],
  });

  // ── Rate limiting ─────────────────────────────────────────────
  // Disabled in test environment — tests share one instance and
  // would trigger the limit across test cases
  if (process.env.NODE_ENV !== "test") {
    await app.register(rateLimit, {
      max:        10,
      timeWindow: "10 seconds",
      errorResponseBuilder: () => ({
        error:   "Too Many Requests",
        message: "You are sending requests too fast. Please slow down.",
      }),
    });
  }

  // ── Routes ───────────────────────────────────────────────────
  await app.register(saleRoutes,     { prefix: "/api" });
  await app.register(purchaseRoutes, { prefix: "/api" });
  await app.register(authRoutes,     { prefix: "/auth" });
  await app.register(adminRoutes,    { prefix: "/admin" });

  // ── Global error handler ─────────────────────────────────────
  app.setErrorHandler((error, _req, reply) => {
    reply.status(error.statusCode ?? 500).send({
      error:   error.name,
      message: error.message,
      // expose stack in non-production so tests can see the real error
      detail:  process.env.NODE_ENV !== "production" ? error.stack : undefined,
    });
  });

  // ── Health check ─────────────────────────────────────────────
  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
