import Redis from "ioredis";

let redis: Redis;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on("error", (err) => {
      console.error("[Redis] connection error:", err.message);
    });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = undefined as unknown as Redis;
  }
}

// ── Key naming ────────────────────────────────────────────────
export const RedisKeys = {
  saleStock:   (saleId: number) => `sale:${saleId}:stock`,
  userBought:  (saleId: number, userId: string) => `sale:${saleId}:user:${userId}:bought`,
  reservation: (saleId: number, userId: string) => `sale:${saleId}:user:${userId}:reservation`,
  saleConfig:  (saleId: number) => `sale:${saleId}:config`,
};

// ── Stock helpers ─────────────────────────────────────────────
export async function initStock(saleId: number, stock: number): Promise<void> {
  await getRedis().set(RedisKeys.saleStock(saleId), stock);
}

export async function getStock(saleId: number): Promise<number | null> {
  const val = await getRedis().get(RedisKeys.saleStock(saleId));
  return val === null ? null : parseInt(val, 10);
}

export async function decrementStock(saleId: number): Promise<number> {
  return getRedis().decr(RedisKeys.saleStock(saleId));
}

export async function incrementStock(saleId: number): Promise<void> {
  await getRedis().incr(RedisKeys.saleStock(saleId));
}

// ── User bought helpers ───────────────────────────────────────
export async function markUserBought(saleId: number, userId: string): Promise<boolean> {
  const key    = RedisKeys.userBought(saleId, userId);
  const result = await getRedis().set(key, "1", "EX", 86_400, "NX");
  return result === "OK";
}

export async function hasUserBought(saleId: number, userId: string): Promise<boolean> {
  const val = await getRedis().get(RedisKeys.userBought(saleId, userId));
  return val !== null;
}

export async function unmarkUserBought(saleId: number, userId: string): Promise<void> {
  await getRedis().del(RedisKeys.userBought(saleId, userId));
}

// ── Reservation helpers ───────────────────────────────────────
const RESERVATION_TTL_SECONDS = 10 * 60; // 10 minutes

// Create reservation key — expires automatically after 10 min
export async function createReservation(saleId: number, userId: string): Promise<string> {
  const key       = RedisKeys.reservation(saleId, userId);
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_SECONDS * 1000).toISOString();
  await getRedis().set(key, expiresAt, "EX", RESERVATION_TTL_SECONDS);
  return expiresAt;
}

// Returns the expiry ISO string if reservation exists, null if expired/missing
export async function getReservation(saleId: number, userId: string): Promise<string | null> {
  return getRedis().get(RedisKeys.reservation(saleId, userId));
}

// Delete reservation key explicitly (on payment or cancellation)
export async function deleteReservation(saleId: number, userId: string): Promise<void> {
  await getRedis().del(RedisKeys.reservation(saleId, userId));
}
