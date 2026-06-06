/**
 * Concurrency and load tests — these create real concurrent pressure on the pod pool.
 * Requires a live Kubernetes cluster.
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
  await Promise.all(leases.filter((l) => l.holder).map((l) => setHolder(l, "")));
  await Bun.sleep(200);
}

function mkOwner(tag: string) {
  return { instanceId: "conctest", requestId: `req-${tag}`, sessionId: "cs", toolCallId: `tc-${tag}` };
}

beforeEach(resetAllLeases);
afterAll(resetAllLeases);

// ─── Burst 8 ─────────────────────────────────────────────────────────────────

describe("burst 8 – full pool", () => {
  it("93. all 8 simultaneous acquires succeed", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(`b8-${i}`))));
    expect(held.length).toBe(8);
    await Promise.all(held.map((h) => h.release()));
  });

  it("94. all 8 get unique pods", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(`u8-${i}`))));
    const names = held.map((h) => h.podName);
    expect(new Set(names).size).toBe(8);
    await Promise.all(held.map((h) => h.release()));
  });

  it("95. pool fully recovers – all 8 leases free after burst", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(`rec-${i}`))));
    await Promise.all(held.map((h) => h.release()));
    await Bun.sleep(300);
    const leases = await listLeases();
    expect(leases.every((l) => isFree(l))).toBe(true);
  });
});

// ─── Burst 9 ─────────────────────────────────────────────────────────────────

describe("burst 9 – one caller queued", () => {
  it("96. 9th caller is queued while 8 pods are held", async () => {
    const held: Acquired[] = [];
    try {
      const eight = await Promise.all(Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(`q9-hold-${i}`))));
      held.push(...eight);

      const ninthPromise = manager.acquire(mkOwner("q9-ninth"));
      await Bun.sleep(200);
      expect(manager.queueDepth).toBeGreaterThanOrEqual(1);

      await held[0]!.release();
      held.shift();
      const ninth = await ninthPromise;
      await ninth.release();
    } finally {
      await Promise.all(held.map((h) => h.release()));
    }
  });

  it("97. all 9 callers eventually get a pod", async () => {
    const results: Acquired[] = [];
    try {
      const all = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
          manager.acquire(mkOwner(`all9-${i}`)).then(async (a) => {
            results.push(a);
            await Bun.sleep(100); // hold briefly
            await a.release();
            return a;
          })
        )
      );
      expect(all.length).toBe(9);
    } finally {
      await Promise.all(results.filter((a) => a).map((a) => a.release().catch(() => {})));
    }
  });

  it("98. no pod is used by two callers at the same time (burst of 9)", async () => {
    const active = new Map<string, string>(); // podName → owner
    const conflicts: string[] = [];

    await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        manager.acquire(mkOwner(`nodup-${i}`)).then(async (a) => {
          if (active.has(a.podName)) {
            conflicts.push(`${a.podName} double-claimed by ${i} while held by ${active.get(a.podName)}`);
          }
          active.set(a.podName, String(i));
          await Bun.sleep(80);
          active.delete(a.podName);
          await a.release();
        })
      )
    );

    expect(conflicts).toEqual([]);
  });
});

// ─── Rapid sequential ────────────────────────────────────────────────────────

describe("rapid sequential cycles", () => {
  it("99. 20 sequential acquire/release cycles all succeed", async () => {
    for (let i = 0; i < 20; i++) {
      const a = await manager.acquire(mkOwner(`seq-${i}`));
      expect(POD_NAMES).toContain(a.podName);
      await a.release();
    }
  });

  it("100. pool stays clean across 5 burst cycles (no lease corruption)", async () => {
    for (let cycle = 0; cycle < 5; cycle++) {
      const held = await Promise.all(
        Array.from({ length: 8 }, (_, i) => manager.acquire(mkOwner(`cycle${cycle}-${i}`)))
      );
      const names = held.map((h) => h.podName);
      expect(new Set(names).size).toBe(8);
      await Promise.all(held.map((h) => h.release()));
      await Bun.sleep(200);
      const leases = await listLeases();
      expect(leases.every((l) => isFree(l))).toBe(true);
    }
  }, 60_000); // 5 cycles can take up to 60s
});