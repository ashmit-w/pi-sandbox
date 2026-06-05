import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { PiClient } from "./pi/types";
import { manager, CapacityTimeoutError } from "./sandbox/leaseManager";
import { getPodsState, sandboxPodsReady } from "./poolState";

/**
 * The HTTP layer. Depends only on the PiClient interface (+ the shared lease
 * manager singleton for queue depth) — it knows nothing about the Pi SDK.
 */
export function createServer(piClient: PiClient) {
  const app = express();
  app.use(express.json({ limit: "256kb" }));

  // POST /chat — run a chat turn; tool calls route through the lease manager.
  app.post("/chat", async (req: Request, res: Response) => {
    const { sessionId, message } = req.body ?? {};
    if (typeof sessionId !== "string" || !sessionId.trim())
      return res.status(400).json({ error: { code: "bad_request", message: "sessionId (string) is required" } });
    if (typeof message !== "string" || !message.trim())
      return res.status(400).json({ error: { code: "bad_request", message: "message (string) is required" } });

    try {
      const result = await piClient.runChat({
        sessionId,
        message,
        requestId: `req-${randomUUID().slice(0, 8)}`,
      });
      res.json(result);
    } catch (e) {
      if (e instanceof CapacityTimeoutError) return res.status(429).json(e.body());
      console.error("chat failed:", e);
      res.status(500).json({ error: { code: "internal_error", message: "chat failed" } });
    }
  });

  // GET /pods — pool state: readiness + lease status + queue depth.
  app.get("/pods", async (_req: Request, res: Response) => {
    try {
      const pods = await getPodsState();
      res.json({ pods, queueDepth: manager.queueDepth });
    } catch (e) {
      console.error("pods read failed:", e);
      res.status(500).json({ error: { code: "internal_error", message: "could not read pod state" } });
    }
  });

  // GET /health — service + cluster health.
  app.get("/health", async (_req: Request, res: Response) => {
    try {
      const ready = await sandboxPodsReady();
      res.json({ ok: true, kubernetes: "connected", sandboxPodsReady: ready });
    } catch {
      res.status(503).json({ ok: false, kubernetes: "error", sandboxPodsReady: 0 });
    }
  });

  return app;
}
