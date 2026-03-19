import { buildApp }                   from "./app";
import { initialiseSaleStock, getActiveSale } from "./services/saleService";
import { startCleanupJob }            from "./jobs/cleanupJob";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

async function start() {
  const app = await buildApp();

  // Re-seed Redis stock from DB on startup
  const sale = getActiveSale();
  if (sale) {
    try {
      await initialiseSaleStock(sale.id);
      app.log.info(`Sale ${sale.id} stock initialised in Redis`);
    } catch {
      app.log.warn("Could not initialise sale stock in Redis");
    }
  }

  // Start background cleanup job — restores stock for expired reservations
  startCleanupJob(60_000); // runs every 60 seconds

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`Server running at http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
