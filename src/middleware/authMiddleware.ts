/**
 * Auth Middleware
 *
 * authenticate — a plain preHandler, imported directly by routes.
 * Uses (req as any) to set userId since decoration happens in app.ts.
 */

import { FastifyRequest, FastifyReply } from "fastify";
import { extractBearerToken, verifyToken } from "../services/authService";

// Extend FastifyRequest to include userId for TypeScript
declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return reply.status(401).send({
      error:   "Unauthorized",
      message: "Missing Authorization header. Expected: Bearer <token>",
    });
  }

  try {
    const payload = verifyToken(token);
    // Use type assertion — userId is decorated in buildApp before routes register
    (req as any).userId = payload.userId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid token";
    return reply.status(401).send({
      error:   "Unauthorized",
      message,
    });
  }
}