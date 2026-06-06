/**
 * Integration tests for the HTTP server endpoints.
 * Spins up the Express app on a random port; requires k8s for /pods and /health.
 *
 * Run with: bun run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { AddressInfo } from "node:net";
import { createServer } from "../../src/server";
import { CapacityTimeoutError } from "../../src/sandbox/leaseManager";
import type { PiClient, ChatInput } from "../../src/pi/types";
import { listLeases, setHolder } from "../../src/sandbox/leases";

// ─── Setup ───────────────────────────────────────────────────────────────────

let base: string;
let server: ReturnType<typeof import("node:http").createServer>;

const mockOk: PiClient = {
  runChat: async (input: ChatInput) => ({
    sessionId: input.sessionId,
    message: "ok",
    toolCalls: [],
  }),
};

const mockTimeout: PiClient = {
  runChat: async () => { throw new CapacityTimeoutError(); },
};

const mockCrash: PiClient = {
  runChat: async () => { throw new Error("unexpected boom"); },
};

beforeAll(async () => {
  const app = createServer(mockOk);
  await new Promise<void>((res) => {
    server = app.listen(0, () => res());
  });
  const port = (server.address() as AddressInfo).port;
  base = `http://localhost:${port}`;
});

afterAll(() => {
  server?.close();
});

// ─── GET /health ─────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("75. returns 200", async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
  });

  it("76. ok = true", async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.ok).toBe(true);
  });

  it("77. kubernetes = 'connected'", async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.kubernetes).toBe("connected");
  });

  it("78. sandboxPodsReady = 8", async () => {
    const body = await (await fetch(`${base}/health`)).json();
    expect(body.sandboxPodsReady).toBe(8);
  });
});

// ─── GET /pods ───────────────────────────────────────────────────────────────

describe("GET /pods", () => {
  it("79. returns 200", async () => {
    const r = await fetch(`${base}/pods`);
    expect(r.status).toBe(200);
  });

  it("80. response.pods is an array of length 8", async () => {
    const body = await (await fetch(`${base}/pods`)).json();
    expect(Array.isArray(body.pods)).toBe(true);
    expect(body.pods.length).toBe(8);
  });

  it("81. each pod has name, ready, and lease fields", async () => {
    const body = await (await fetch(`${base}/pods`)).json();
    for (const pod of body.pods) {
      expect(pod).toHaveProperty("name");
      expect(pod).toHaveProperty("ready");
      expect(pod).toHaveProperty("lease");
    }
  });

  it("82. free pod has lease.status = 'free'", async () => {
    const body = await (await fetch(`${base}/pods`)).json();
    const free = body.pods.find((p: any) => p.lease.status === "free");
    expect(free).toBeDefined();
  });

  it("83. response includes queueDepth (number)", async () => {
    const body = await (await fetch(`${base}/pods`)).json();
    expect(typeof body.queueDepth).toBe("number");
  });
});

// ─── POST /chat – validation ──────────────────────────────────────────────────

describe("POST /chat – input validation", () => {
  async function post(body: unknown) {
    return fetch(`${base}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("84. missing sessionId → 400 with bad_request code", async () => {
    const r = await post({ message: "hi" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("85. empty string sessionId → 400", async () => {
    const r = await post({ sessionId: "  ", message: "hi" });
    expect(r.status).toBe(400);
  });

  it("86. missing message → 400 with bad_request code", async () => {
    const r = await post({ sessionId: "s1" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe("bad_request");
  });

  it("87. empty string message → 400", async () => {
    const r = await post({ sessionId: "s1", message: "  " });
    expect(r.status).toBe(400);
  });
});

// ─── POST /chat – success ─────────────────────────────────────────────────────

describe("POST /chat – successful request", () => {
  async function chat(body: unknown) {
    return fetch(`${base}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("88. valid request → 200", async () => {
    const r = await chat({ sessionId: "s1", message: "hi" });
    expect(r.status).toBe(200);
  });

  it("89. response.sessionId matches request sessionId", async () => {
    const r = await chat({ sessionId: "session-abc", message: "hi" });
    const body = await r.json();
    expect(body.sessionId).toBe("session-abc");
  });

  it("90. response.toolCalls is an array", async () => {
    const r = await chat({ sessionId: "s1", message: "hi" });
    const body = await r.json();
    expect(Array.isArray(body.toolCalls)).toBe(true);
  });
});

// ─── POST /chat – error paths ─────────────────────────────────────────────────

describe("POST /chat – error handling", () => {
  it("91. CapacityTimeoutError from client → 429 with sandbox_capacity_timeout", async () => {
    const app = createServer(mockTimeout);
    const s = await new Promise<ReturnType<typeof import("node:http").createServer>>((res) => {
      const srv = app.listen(0, () => res(srv));
    });
    const port = (s.address() as AddressInfo).port;
    try {
      const r = await fetch(`http://localhost:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s", message: "hi" }),
      });
      expect(r.status).toBe(429);
      const body = await r.json();
      expect(body.error.code).toBe("sandbox_capacity_timeout");
    } finally {
      s.close();
    }
  });

  it("92. unexpected error from client → 500", async () => {
    const app = createServer(mockCrash);
    const s = await new Promise<ReturnType<typeof import("node:http").createServer>>((res) => {
      const srv = app.listen(0, () => res(srv));
    });
    const port = (s.address() as AddressInfo).port;
    try {
      const r = await fetch(`http://localhost:${port}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s", message: "hi" }),
      });
      expect(r.status).toBe(500);
    } finally {
      s.close();
    }
  });
});