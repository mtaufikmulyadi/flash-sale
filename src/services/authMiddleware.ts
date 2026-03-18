/**
 * Auth Middleware
 *
 * Fastify preHandler hook — runs before route handlers on
 * any route that calls fastify.authenticate().
 *
 * Extracts userId from the JWT and attaches it to the request
 * so route handlers can use req.userId without touching headers.
 *
 * Usage in routes:
 *   fastify.post('/api/purchase', { preHandler: [fastify.authenticate] }, handler)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { extractBearerToken, verifyToken } from "../services/authService";

// Extend FastifyRequest to include userId
declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  // Decorate request with default userId (overwritten on auth)
  fastify.decorateRequest("userId", "");

  // authenticate — attach as preHandler to protected routes
  fastify.decorate(
    "authenticate",
    async function (req: FastifyRequest, reply: FastifyReply) {
      const token = extractBearerToken(req.headers.authorization);

      if (!token) {
        return reply.status(401).send({
          error:   "Unauthorized",
          message: "Missing Authorization header. Expected: Bearer <token>",
        });
      }

      try {
        const payload = verifyToken(token);
        req.userId = payload.userId;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid token";
        return reply.status(401).send({
          error:   "Unauthorized",
          message,
        });
      }
    }
  );
}

// Extend FastifyInstance type for authenticate decorator
declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(authPlugin, { name: "auth" });
