/**
 * Admin routes
 *
 * POST /admin/sale  — create a new sale (replaces existing)
 * GET  /admin/sale  — get current sale config
 *
 * In production these would be protected by an admin JWT role.
 * For this project they are unprotected but clearly namespaced.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { seedSale } from "../db/seed";
import { getActiveSale } from "../services/saleService";

const CreateSaleSchema = z.object({
  productName: z.string().min(1).max(100),
  stock:       z.number().int().min(1).max(100_000),
  startTime:   z.string().datetime({ message: "startTime must be a valid ISO 8601 date" }),
  endTime:     z.string().datetime({ message: "endTime must be a valid ISO 8601 date" }),
}).refine(
  (d) => new Date(d.endTime) > new Date(d.startTime),
  { message: "endTime must be after startTime" }
);

export default async function adminRoutes(app: FastifyInstance) {

  // ── GET /admin/sale ────────────────────────────────────────
  app.get("/sale", async (_req, reply) => {
    const sale = getActiveSale();
    if (!sale) {
      return reply.status(404).send({ message: "No sale configured" });
    }
    return reply.status(200).send(sale);
  });

  // ── POST /admin/sale ───────────────────────────────────────
  app.post("/sale", async (req, reply) => {
    const parsed = CreateSaleSchema.safeParse(req.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error:   "Bad Request",
        message: parsed.error.errors[0].message,
      });
    }

    const { productName, stock, startTime, endTime } = parsed.data;

    const saleId = await seedSale({
      stock,
      productName,
      startTime,
      endTime,
    });

    return reply.status(201).send({
      message: "Sale created successfully",
      saleId,
      productName,
      stock,
      startTime,
      endTime,
    });
  });
}
