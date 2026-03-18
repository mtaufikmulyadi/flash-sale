import Redis from "ioredis";

// ----------------------------------------------------------------
// Single Redis connection, reused across the app
// ----------------------------------------------------------------
let redis: Redis;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      // If Redis is down, fail fast rather than hang
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

// ----------------------------------------------------------------
// Key naming conventions — all Redis keys live here
// Centralised so there's one place to change them
// ----------------------------------------------------------------
export const RedisKeys = {
  // Stores remaining stock count  e.g. "sale:1:stock"
  saleStock: (saleId: number) => `sale:${saleId}:stock`,

  // Exists if user has bought for this sale  e.g. "sale:1:user:alice:bought"
  userBought: (saleId: number, userId: string) =>
    `sale:${saleId}:user:${userId}:bought`,

  // Cached sale config object  e.g. "sale:1:config"
  saleConfig: (saleId: number) => `sale:${saleId}:config`,
};

// ----------------------------------------------------------------
// Redis helpers — small wrappers so services stay readable
// ----------------------------------------------------------------

// Initialise stock counter when a sale is created
export async function initStock(saleId: number, stock: number): Promise<void> {
  const r = getRedis();
  await r.set(RedisKeys.saleStock(saleId), stock);
}

// Returns remaining stock, or null if key doesn't exist
export async function getStock(saleId: number): Promise<number | null> {
  const r = getRedis();
  const val = await r.get(RedisKeys.saleStock(saleId));
  return val === null ? null : parseInt(val, 10);
}

// Atomically mark user as bought
// Returns true  = first time (allowed)
// Returns false = already bought (reject)
export async function markUserBought(
  saleId: number,
  userId: string
): Promise<boolean> {
  const r = getRedis();
  const key = RedisKeys.userBought(saleId, userId);
  // NX = only set if not exists | EX = expire after 24 hours
  const result = await r.set(key, "1", "EX", 86_400, "NX");
  return result === "OK"; // OK = key was new, null = already existed
}

// Atomically decrement stock
// Returns the new value — caller must check if < 0 (oversold)
export async function decrementStock(saleId: number): Promise<number> {
  const r = getRedis();
  return r.decr(RedisKeys.saleStock(saleId));
}

// Undo a decrement — called when stock went negative (compensation)
export async function incrementStock(saleId: number): Promise<void> {
  const r = getRedis();
  await r.incr(RedisKeys.saleStock(saleId));
}

// Remove user bought flag — called during compensation
export async function unmarkUserBought(
  saleId: number,
  userId: string
): Promise<void> {
  const r = getRedis();
  await r.del(RedisKeys.userBought(saleId, userId));
}

// Check if user already bought without modifying state
export async function hasUserBought(
  saleId: number,
  userId: string
): Promise<boolean> {
  const r = getRedis();
  const val = await r.get(RedisKeys.userBought(saleId, userId));
  return val !== null;
}