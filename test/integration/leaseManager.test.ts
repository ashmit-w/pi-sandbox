/**
 * Integration tests for the LeaseManager + lease CAS layer.
 * Requires a real Kubernetes cluster with the pi-sandbox namespace and leases.
 *
 * Run with: bun run test:integration
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { manager, CapacityTimeoutError } from "../../src/sandbox/leaseManager";
import type { Acquired } from "../../src/sandbox/leaseManager";
import { listLeases, setHolder, isFree } from "../../src/sandbox/leases";

const POD_NAMES = Array.from({ length: 8 }, (_, i) => `sandbox-runner-${i}`);

async function resetAllLeases() {
  const leases = await listLeases();
  await Promise.all(
    leases.filter((l) => l.holder).map((l) => setHolder(l, ""))
  );
  // short settle wait so k8s resourceVersions are stable for the next test
  await Bun.sleep(200);
}

function mkOwner(n: string | number) {
  return { instanceId: "test", requestId: `req-${n}`, sessionId: "s", toolCallId: `tc-${n}` };
}

beforeEach(async () => {
  await resetAllLeases();
});

afterAll(async () => {
  await resetAllLeases();
});

// ─── Basic acquire / release ─────────────────────────────────────────────────

describe("acquire / release basics", () => {
  it("48. acquire() resolves without throwing", async () => {
    const a = await manager.acquire(mkOwner(48));
    await a.release();
  });

  it("49. resolved value has .podName property", async () => {
    const a = await manager.acquire(mkOwner(49));
    expect(a).toHaveProperty("podName");
    await a.release();
  });

  it("50. podName matches /^sandbox-runner-[0-7]$/", async () => {
    const a = await manager.acquire(mkOwner(50));
    expect(a.podName).toMatch(/^sandbox-runner-[0-7]$/);
    await a.release();
  });

  it("51. k8s lease shows holderIdentity after acquire", async () => {
    const a = await manager.acquire(mkOwner(51));
    const leases = await listLeases();
    const held = leases.find((l) => l.name === a.podName)!;
    expect(held.holder).toContain("test:req-51:s:tc-51");
    await a.release();
  });

  it("52. release() clears holderIdentity in k8s", async () => {
    const a = await manager.acquire(mkOwner(52));
    await a.release();
    const leases = await listLeases();
    const freed = leases.find((l) => l.name === a.podName)!;
    expect(freed.holder).toBe("");
  });

  it("53. pod can be re-acquired immediately after release", async () => {
    const a = await manager.acquire(mkOwner(53));
    await a.release();
    const b = await manager.acquire(mkOwner(53));
    expect(POD_NAMES).toContain(b.podName);
    await b.release();
  });

  it("54. acquire + release roundtrip completes within 5 seconds", async () => {
    const start = Date.now();
    const a = await manager.acquire(mkOwner(54));
    await a.release();
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});

// ─── Concurrent – no double claim ────────────────────────────────────────────

describe("concurrent acquires – unique pod per caller", () => {
  it("55. 2 concurrent acquires return different pods", async () => {
    const [a, b] = await Promise.all([
      manager.acquire(mkOwner(55_1)),
      manager.acquire(mkOwner(55_2)),
    ]);
    expect(a.podName).not.toBe(b.podName);
    await Promise.all([a.release(), b.release()]);
  });

  it("56. 4 concurrent acquires all get unique pods", async () => {
    const held = await Promise.all(Array.from({ length: 4 }, (_, i) => manager.acquire(mkOwner(56_0 + i))));
    const names = held.map((h) => h.podName);
    expect(new Set(names).size).toBe(4);
    await Promise.all(held.map((h) => h.release()));
  });

  it("57. 8 concurrent acquires all get unique pods", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(57_0 + i))));
    const names = held.map((h) => h.podName);
    expect(new Set(names).size).toBe(8);
    await Promise.all(held.map((h) => h.release()));
  });

  it("58. 8 concurrent acquires all succeed (none rejected)", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(58_0 + i)))
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(8);
    await Promise.all(
      results.filter((r): r is PromiseFulfilledResult<Acquired> => r.status === "fulfilled")
        .map((r) => r.value.release())
    );
  });
});

// ─── Queue behaviour ─────────────────────────────────────────────────────────

describe("FIFO queue", () => {
  it("59. queueDepth is 0 when nothing is waiting", () => {
    expect(manager.queueDepth).toBe(0);
  });

  it("60. queueDepth ≥ 1 while all 8 pods are held and a 9th waits", async () => {
    const held: Acquired[] = [];
    try {
      const eight = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(60_0 + i))));
      held.push(...eight);

      // kick off the 9th — don't await, it's blocked
      const ninth = manager.acquire(mkOwner(60_9));
      await Bun.sleep(150); // let pump try once
      expect(manager.queueDepth).toBeGreaterThanOrEqual(1);

      // release one so ninth can resolve
      await held[0]!.release();
      held.shift();
      await ninth.then((a) => a.release());
    } finally {
      await Promise.all(held.map((h) => h.release()));
    }
  });

  it("61. queued 9th caller resolves when a pod is released", async () => {
    const held: Acquired[] = [];
    try {
      const eight = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(61_0 + i))));
      held.push(...eight);

      const ninthPromise = manager.acquire(mkOwner(61_9));
      await Bun.sleep(150);

      // release one → 9th should resolve
      await held[0]!.release();
      held.shift();

      const ninth = await ninthPromise;
      expect(POD_NAMES).toContain(ninth.podName);
      await ninth.release();
    } finally {
      await Promise.all(held.map((h) => h.release()));
    }
  });

  it("62. queueDepth returns to 0 after all waiters resolve", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(62_0 + i))));
    const ninthPromise = manager.acquire(mkOwner(62_9));
    await Bun.sleep(150);

    await Promise.all(held.map((h) => h.release()));
    const ninth = await ninthPromise;
    await ninth.release();
    await Bun.sleep(150);

    expect(manager.queueDepth).toBe(0);
  });

  it("63. FIFO: earlier queued caller resolves before later one", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(63_0 + i))));

    const order: number[] = [];
    const pA = manager.acquire(mkOwner("63a")).then((x) => { order.push(1); return x; });
    await Bun.sleep(50);
    const pB = manager.acquire(mkOwner("63b")).then((x) => { order.push(2); return x; });

    // release 2 pods so both queued callers can proceed
    await held[0]!.release();
    await Bun.sleep(100);
    await held[1]!.release();

    const [ra, rb] = await Promise.all([pA, pB]);
    await Promise.all([ra.release(), rb.release(), ...held.slice(2).map((h) => h.release())]);

    expect(order[0]).toBe(1); // first queued resolves first
  });
});

// ─── Error shapes ─────────────────────────────────────────────────────────────

describe("CapacityTimeoutError", () => {
  it("64. CapacityTimeoutError is an instance of Error", () => {
    const e = new CapacityTimeoutError();
    expect(e).toBeInstanceOf(Error);
  });

  it("65. name === 'CapacityTimeoutError'", () => {
    expect(new CapacityTimeoutError().name).toBe("CapacityTimeoutError");
  });

  it("66. body() returns error.code = 'sandbox_capacity_timeout'", () => {
    expect(new CapacityTimeoutError().body().error.code).toBe("sandbox_capacity_timeout");
  });

  it("67. body().error.message is a non-empty string", () => {
    const msg = new CapacityTimeoutError().body().error.message;
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  it("68. actual timeout: CapacityTimeoutError thrown after max-wait (real 15s)", async () => {
    // Hold all 8 pods, attempt 9th — should reject after ~15s
    const held: Acquired[] = [];
    try {
      const eight = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(68_0 + i))));
      held.push(...eight);

      await expect(manager.acquire(mkOwner(68_9))).rejects.toBeInstanceOf(CapacityTimeoutError);
    } finally {
      await Promise.all(held.map((h) => h.release()));
    }
  }, 20_000); // give the test 20s (timeout fires after 15s)
});

// ─── Lease primitives ────────────────────────────────────────────────────────

describe("lease primitives", () => {
  it("69. listLeases() returns exactly 8 leases", async () => {
    const leases = await listLeases();
    expect(leases.length).toBe(8);
  });

  it("70. all leases are free after reset", async () => {
    const leases = await listLeases();
    expect(leases.every((l) => isFree(l))).toBe(true);
  });

  it("71. setHolder returns true on valid first claim", async () => {
    const leases = await listLeases();
    const free = leases.find((l) => isFree(l))!;
    const ok = await setHolder(free, "test-holder");
    expect(ok).toBe(true);
    // cleanup
    const updated = (await listLeases()).find((l) => l.name === free.name)!;
    await setHolder(updated, "");
  });

  it("72. setHolder returns false on stale resourceVersion (CAS conflict)", async () => {
    const leases = await listLeases();
    const free = leases.find((l) => isFree(l))!;
    // First claim succeeds — resourceVersion now changed on the server
    await setHolder(free, "first-holder");
    // Using the OLD lease object (stale resourceVersion) should fail
    const ok = await setHolder(free, "second-holder");
    expect(ok).toBe(false);
    // cleanup
    const updated = (await listLeases()).find((l) => l.name === free.name)!;
    await setHolder(updated, "");
  });
});

// ─── Release safety ──────────────────────────────────────────────────────────

describe("release safety", () => {
  it("73. calling release() twice is safe (no throw)", async () => {
    const a = await manager.acquire(mkOwner(73));
    await a.release();
    await expect(a.release()).resolves.toBeUndefined();
  });

  it("74. release() does not clear a lease held by a different owner", async () => {
    const a = await manager.acquire(mkOwner("74a"));
    const podName = a.podName;

    // Simulate another caller claiming the same lease (force-write via setHolder)
    const leases = await listLeases();
    const l = leases.find((x) => x.name === podName)!;
    await setHolder(l, "intruder");

    // a.release() should NOT clear "intruder" (identity mismatch)
    await a.release();

    const after = (await listLeases()).find((x) => x.name === podName)!;
    expect(after.holder).toBe("intruder");

    // cleanup
    const fresh = (await listLeases()).find((x) => x.name === podName)!;
    await setHolder(fresh, "");
  });
});