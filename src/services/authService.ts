/**
 * Mock Auth Service
 *
 * Simulates a real JWT auth system without a full auth server.
 * Pattern is production-correct — only the secret management
 * is simplified (env var instead of a key management service).
 *
 * In production this would be:
 *   - Auth server issues signed JWTs on login
 *   - This service only VERIFIES tokens (never issues them)
 *   - Secret rotated via AWS KMS / Vault etc.
 *
 * For this project:
 *   - generateToken() acts as the "auth server" (used in tests + seed)
 *   - verifyToken() is what the real API uses on every request
 *   - Secret lives in JWT_SECRET env var
 */

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "24h";

// ----------------------------------------------------------------
// Token payload shape
// ----------------------------------------------------------------
export type TokenPayload = {
  userId: string;
  iat?: number;
  exp?: number;
};

// ----------------------------------------------------------------
// generateToken — acts as the mock "auth server"
// Used in: tests, seed script, and a /auth/token dev-only route
// NOT used in production purchase flow
// ----------------------------------------------------------------
export function generateToken(userId: string): string {
  if (!userId || userId.trim().length === 0) {
    throw new Error("userId is required to generate a token");
  }
  return jwt.sign({ userId } as TokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// ----------------------------------------------------------------
// verifyToken — used by authMiddleware on every protected request
// Returns the payload if valid, throws if invalid/expired
// ----------------------------------------------------------------
export function verifyToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return payload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error("Token expired");
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error("Invalid token");
    }
    throw err;
  }
}

// ----------------------------------------------------------------
// extractBearerToken — pulls token from Authorization header
// Returns null if header is missing or malformed
// ----------------------------------------------------------------
export function extractBearerToken(
  authHeader: string | undefined
): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}
