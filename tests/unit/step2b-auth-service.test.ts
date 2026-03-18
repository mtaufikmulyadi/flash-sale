/**
 * STEP 2b TESTS — Auth service
 *
 * Tests the mock JWT auth layer:
 *  - generateToken produces a valid JWT
 *  - verifyToken returns the correct payload
 *  - verifyToken throws on invalid/expired/tampered tokens
 *  - extractBearerToken parses the Authorization header correctly
 */

import { describe, it, expect } from "@jest/globals";
import jwt from "jsonwebtoken";
import {
  generateToken,
  verifyToken,
  extractBearerToken,
  type TokenPayload,
} from "../../src/services/authService";

// ----------------------------------------------------------------
// generateToken
// ----------------------------------------------------------------
describe("generateToken", () => {
  it("returns a non-empty JWT string", () => {
    const token = generateToken("alice@test.com");
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3); // header.payload.signature
  });

  it("encodes the userId in the payload", () => {
    const token = generateToken("alice@test.com");
    const decoded = jwt.decode(token) as TokenPayload;
    expect(decoded.userId).toBe("alice@test.com");
  });

  it("includes iat and exp fields", () => {
    const token = generateToken("alice@test.com");
    const decoded = jwt.decode(token) as TokenPayload;
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
  });

  it("throws if userId is empty", () => {
    expect(() => generateToken("")).toThrow("userId is required");
  });

  it("throws if userId is only whitespace", () => {
    expect(() => generateToken("   ")).toThrow("userId is required");
  });

  it("generates different tokens for different userIds", () => {
    const t1 = generateToken("alice@test.com");
    const t2 = generateToken("bob@test.com");
    expect(t1).not.toBe(t2);
  });
});

// ----------------------------------------------------------------
// verifyToken
// ----------------------------------------------------------------
describe("verifyToken", () => {
  it("returns correct payload for a valid token", () => {
    const token = generateToken("alice@test.com");
    const payload = verifyToken(token);
    expect(payload.userId).toBe("alice@test.com");
  });

  it("throws 'Invalid token' for a tampered token", () => {
    const token = generateToken("alice@test.com");
    const tampered = token.slice(0, -5) + "XXXXX"; // corrupt signature
    expect(() => verifyToken(tampered)).toThrow("Invalid token");
  });

  it("throws 'Invalid token' for a random string", () => {
    expect(() => verifyToken("not.a.token")).toThrow("Invalid token");
  });

  it("throws 'Invalid token' for an empty string", () => {
    expect(() => verifyToken("")).toThrow("Invalid token");
  });

  it("throws 'Token expired' for an already-expired token", () => {
    // Sign a token that expired 1 second ago
    const secret = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
    const expired = jwt.sign({ userId: "alice@test.com" }, secret, {
      expiresIn: -1, // already expired
    });
    expect(() => verifyToken(expired)).toThrow("Token expired");
  });

  it("throws 'Invalid token' for a token signed with wrong secret", () => {
    const wrongSecret = jwt.sign(
      { userId: "alice@test.com" },
      "totally-wrong-secret"
    );
    expect(() => verifyToken(wrongSecret)).toThrow("Invalid token");
  });
});

// ----------------------------------------------------------------
// extractBearerToken
// ----------------------------------------------------------------
describe("extractBearerToken", () => {
  it("extracts token from a valid Bearer header", () => {
    const token = generateToken("alice@test.com");
    const result = extractBearerToken(`Bearer ${token}`);
    expect(result).toBe(token);
  });

  it("returns null when header is undefined", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("returns null when header is empty string", () => {
    expect(extractBearerToken("")).toBeNull();
  });

  it("returns null when scheme is not Bearer", () => {
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });

  it("returns null when header has no token part", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
  });

  it("returns null when header has extra spaces", () => {
    expect(extractBearerToken("Bearer tok en")).toBeNull();
  });

  it("is case-insensitive for the Bearer scheme", () => {
    const token = generateToken("alice@test.com");
    const result = extractBearerToken(`bearer ${token}`);
    expect(result).toBe(token);
  });
});
