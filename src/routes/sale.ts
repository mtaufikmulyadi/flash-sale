/**
 * Sale routes
 *
 * GET /api/sale
 *   Public — no auth required
 *   Returns current sale state including live stock count
 */

import { FastifyInstance } from "fastify";
import { getSaleState } from "../services/saleService";

export default async function saleRoutes(app: FastifyInstance) {
  app.get("/sale", async (_req, reply) => {
    const state = await getSaleState();

    if (!state) {
      return reply.status(404).send({
        error:   "Not Found",
        message: "No sale found",
      });
    }

    return reply.status(200).send(state);
  });
}
