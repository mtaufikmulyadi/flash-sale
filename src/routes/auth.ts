/**
 * Auth routes — dev/test only
 *
 * POST /auth/token
 *   Accepts a userId, returns a signed JWT.
 *   This simulates what a real auth server would do.
 *   Should be disabled or protected in production.
 */

import { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { generateToken } from "../services/authService";

const TokenSchema = z.object({
  userId: z
    .string()
    .min(3,   "userId must be at least 3 characters")
    .max(100, "userId must be at most 100 characters")
    .regex(
      /^[a-zA-Z0-9@._+-]+$/,
      "userId contains invalid characters"
    ),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post(
    "/token",
    async (req: FastifyRequest, reply) => {
      const parsed = TokenSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error:   "Bad Request",
          message: parsed.error.errors[0].message,
        });
      }

      const { userId } = parsed.data;
      const token = generateToken(userId);

      return reply.status(200).send({
        token,
        userId,
        note: "This endpoint is for development only",
      });
    }
  );
}
