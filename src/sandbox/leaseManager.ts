import { listLeases, isFree, setHolder } from "./leases";

const MAX_WAIT_MS = Number(process.env.QUEUE_MAX_WAIT_MS ?? 15_000);
const POLL_MS = 300;

/** Who holds a lease — encoded into holderIdentity for debuggability. */
export type Owner = {
  instanceId: string;
  requestId: string;
  sessionId: string;
  toolCallId: string;
};
const holderIdentity = (o: Owner) =>
  `${o.instanceId}:${o.requestId}:${o.sessionId}:${o.toolCallId}`;

export class CapacityTimeoutError extends Error {
  constructor() {
    super("No sandbox pod became available within 15 seconds.");
    this.name = "CapacityTimeoutError";
  }
  body() {
    return { error: { code: "sandbox_capacity_timeout", message: this.message } };
  }
}

export type Acquired = { podName: string; release: () => Promise<void> };
type Waiter = {
  owner: Owner;
  resolve: (a: Acquired) => void;
  reject: (e: Error) => void;
  deadline: number;
};

/**
 * Just-in-time pod leasing with a bounded FIFO queue. One `pump` loop serves
 * the queue head-first, one at a time. The Kubernetes Lease (compare-and-swap
 * in leases.ts) is the real lock; this just decides who asks next, in order.
 */
export class LeaseManager {
  private queue: Waiter[] = [];
  private pumping = false;

  /** Park the caller in the FIFO queue; resolved when a pod is free. */
  acquire(owner: Owner): Promise<Acquired> {
    return new Promise((resolve, reject) => {
      this.queue.push({ owner, resolve, reject, deadline: Date.now() + MAX_WAIT_MS });
      void this.pump();
    });
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return; // only one pump runs at a time
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const w = this.queue[0]!;
        if (Date.now() > w.deadline) {
          this.queue.shift();
          w.reject(new CapacityTimeoutError());
          continue;
        }
        const got = await this.claimFreePod(w.owner);
        if (got) {
          this.queue.shift();
          w.resolve(got);
          continue;
        }
        await Bun.sleep(POLL_MS); // none free → wait, then retry the head
      }
    } finally {
      this.pumping = false;
    }
  }

  private async claimFreePod(owner: Owner): Promise<Acquired | null> {
    let leases;
    try {
      leases = await listLeases();
    } catch {
      return null; // transient hiccup; pump retries
    }
    for (const l of leases) {
      if (!isFree(l)) continue;
      if (await setHolder(l, holderIdentity(owner))) {
        return { podName: l.name, release: () => this.release(l.name, owner) };
      }
      // someone claimed it first (409) → try the next free lease
    }
    return null;
  }

  private async release(podName: string, owner: Owner): Promise<void> {
    try {
      const l = (await listLeases()).find((x) => x.name === podName);
      if (l && l.holder === holderIdentity(owner)) await setHolder(l, "");
    } catch {
      // best-effort; the lease otherwise expires via its TTL
    }
  }
}

/** The single shared pool for the whole process. */
export const manager = new LeaseManager();
