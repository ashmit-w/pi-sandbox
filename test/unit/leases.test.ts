import { describe, it, expect } from "bun:test";
import { isFree, expiresAt, TTL } from "../../src/sandbox/leases";
import type { Lease } from "../../src/sandbox/leases";

// Helpers to construct Lease objects without touching k8s
function lease(overrides: Partial<Lease> = {}): Lease {
  return { name: "sandbox-runner-0", holder: "", renewTime: undefined, resourceVersion: "1", ...overrides };
}

function renewedAt(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

// ─── isFree ─────────────────────────────────────────────────────────────────

describe("isFree", () => {
  it("37. empty holder → free", () => {
    expect(isFree(lease({ holder: "" }))).toBe(true);
  });

  it("38. holder set + renewTime 1 hour from now → NOT free", () => {
    expect(isFree(lease({ holder: "owner", renewTime: renewedAt(3_600_000) }))).toBe(false);
  });

  it("39. holder set + no renewTime → NOT free (treat as indefinitely held)", () => {
    expect(isFree(lease({ holder: "owner", renewTime: undefined }))).toBe(false);
  });

  it("40. holder set + renewTime 1 hour ago (well past TTL) → free (expired)", () => {
    expect(isFree(lease({ holder: "owner", renewTime: renewedAt(-3_600_000) }))).toBe(true);
  });

  it("41. holder set + renewTime 1 ms before TTL expiry → NOT free yet", () => {
    const almostExpired = renewedAt(-(TTL * 1000 - 1));
    expect(isFree(lease({ holder: "owner", renewTime: almostExpired }))).toBe(false);
  });

  it("42. holder set + renewTime 1 s past TTL boundary → free (just expired)", () => {
    const justExpired = renewedAt(-(TTL * 1000 + 1000));
    expect(isFree(lease({ holder: "owner", renewTime: justExpired }))).toBe(true);
  });
});

// ─── expiresAt ───────────────────────────────────────────────────────────────

describe("expiresAt", () => {
  it("43. no holder → undefined", () => {
    expect(expiresAt(lease({ holder: "" }))).toBeUndefined();
  });

  it("44. holder set + no renewTime → undefined", () => {
    expect(expiresAt(lease({ holder: "owner", renewTime: undefined }))).toBeUndefined();
  });

  it("45. holder set + renewTime → returns ISO string", () => {
    const result = expiresAt(lease({ holder: "owner", renewTime: renewedAt(0) }));
    expect(typeof result).toBe("string");
  });

  it("46. expiresAt = renewTime + TTL seconds", () => {
    const now = Date.now();
    const renewTime = new Date(now).toISOString();
    const result = expiresAt(lease({ holder: "owner", renewTime }));
    const expected = new Date(now + TTL * 1000).toISOString();
    expect(result).toBe(expected);
  });

  it("47. expiresAt result is parseable as a valid Date", () => {
    const result = expiresAt(lease({ holder: "owner", renewTime: renewedAt(0) }));
    expect(isNaN(new Date(result!).getTime())).toBe(false);
  });
});