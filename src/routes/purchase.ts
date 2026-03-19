/**
 * Purchase routes
 *
 * POST /api/purchase
 *   Protected — requires valid JWT in Authorization header
 *
 * GET /api/purchase/:userId
 *   Protected — requires valid JWT, user can only check own status
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/authMiddleware";
import { attemptPurchase, getPurchaseStatus } from "../services/purchaseService";

const ERROR_STATUS: Record<string, number> = {
  SALE_NOT_FOUND:    400,
  SALE_NOT_ACTIVE:   400,
  ALREADY_PURCHASED: 409,
  SOLD_OUT:          410,
  DB_ERROR:          500,
};

export default async function purchaseRoutes(app: FastifyInstance) {

  // ── POST /api/purchase ──────────────────────────────────────
  app.post(
    "/purchase",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const userId = req.userId;
      const result = await attemptPurchase(userId);

      if (!result.success) {
        const status = ERROR_STATUS[result.code] ?? 500;
        return reply.status(status).send({
          error:   result.code,
          message: result.message,
        });
      }

      return reply.status(201).send({
        message:    result.message,
        purchaseId: result.purchaseId,
      });
    }
  );

  // ── GET /api/purchase/:userId ───────────────────────────────
  app.get<{ Params: { userId: string } }>(
    "/purchase/:userId",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const { userId } = req.params;

      if (userId !== req.userId) {
        return reply.status(403).send({
          error:   "Forbidden",
          message: "You can only check your own purchase status",
        });
      }

      const parsed = z.string().min(1).max(200).safeParse(userId);
      if (!parsed.success) {
        return reply.status(400).send({
          error:   "Bad Request",
          message: "Invalid userId",
        });
      }

      const status = await getPurchaseStatus(userId);
      return reply.status(200).send(status);
    }
  );
}