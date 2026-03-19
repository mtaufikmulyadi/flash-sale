/**
 * Purchase + Payment routes
 *
 * POST /api/purchase          → reserve a slot (pending)
 * POST /api/payment           → pay or cancel reservation
 * GET  /api/purchase/:userId  → check status
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/authMiddleware";
import {
  attemptPurchase, processPayment, getPurchaseStatus,
} from "../services/purchaseService";

const ERROR_STATUS: Record<string, number> = {
  SALE_NOT_FOUND:       400,
  SALE_NOT_ACTIVE:      400,
  ALREADY_PURCHASED:    409,
  SOLD_OUT:             410,
  RESERVATION_EXPIRED:  410,
  RESERVATION_NOT_FOUND:410,
  ALREADY_PROCESSED:    409,
  DB_ERROR:             500,
};

export default async function purchaseRoutes(app: FastifyInstance) {

  // ── POST /api/purchase ─────────────────────────────────────
  app.post("/purchase", { preHandler: [authenticate] }, async (req, reply) => {
    const result = await attemptPurchase(req.userId);
    if (!result.success) {
      return reply.status(ERROR_STATUS[result.code] ?? 500).send({
        error: result.code, message: result.message,
      });
    }
    return reply.status(201).send({
      message:      result.message,
      purchaseId:   result.purchaseId,
      reservedUntil: result.reservedUntil,
    });
  });

  // ── POST /api/payment ──────────────────────────────────────
  app.post("/payment", { preHandler: [authenticate] }, async (req, reply) => {
    const schema = z.object({
      action: z.enum(["pay", "cancel"]),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error:   "Bad Request",
        message: "action must be 'pay' or 'cancel'",
      });
    }

    const result = await processPayment(req.userId, parsed.data.action);
    if (!result.success) {
      return reply.status(ERROR_STATUS[result.code] ?? 500).send({
        error: result.code, message: result.message,
      });
    }

    return reply.status(200).send({
      status:  result.status,
      message: result.message,
    });
  });

  // ── GET /api/purchase/:userId ──────────────────────────────
  app.get<{ Params: { userId: string } }>(
    "/purchase/:userId",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const { userId } = req.params;
      if (userId !== req.userId) {
        return reply.status(403).send({ error: "Forbidden", message: "You can only check your own purchase status" });
      }
      const parsed = z.string().min(1).max(200).safeParse(userId);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Bad Request", message: "Invalid userId" });
      }
      const status = await getPurchaseStatus(userId);
      return reply.status(200).send(status);
    }
  );
}
