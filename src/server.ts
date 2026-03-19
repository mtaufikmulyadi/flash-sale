/**
 * Server entry point
 * Starts the HTTP listener. Import buildApp from app.ts instead
 * of this file so tests never accidentally start a TCP server.
 */

import { buildApp } from "./app";
import { initialiseSaleStock, getActiveSale } from "./services/saleService";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

async function start() {
  const app = await buildApp();

  // Seed Redis stock from DB on startup
  // Handles the case where server restarted mid-sale
  const sale = getActiveSale();
  if (sale) {
    try {
      await initialiseSaleStock(sale.id);
      app.log.info(`Sale ${sale.id} stock initialised in Redis`);
    } catch (err) {
      app.log.warn("Could not initialise sale stock in Redis");
    }
  }

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Server running at http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
