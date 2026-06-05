# pi-sandbox-min

A minimal Pi agent whose tool calls execute inside Kubernetes sandbox pods. A
fixed pool of **8 warm pods** is leased just-in-time per tool call (Kubernetes
`Lease` = the lock), with a FIFO queue (15s max) when all 8 are busy.

Everything talks to Kubernetes through the **`kubectl`** binary — no client
library, so no TLS / auth / proxy setup. Runtime is **Bun**.

## Three layers

The whole codebase is three pillars, each behind a clear seam:

| Layer | Files | Function |
| --- | --- | --- |
| **Server** | `server.ts`, `poolState.ts`, `index.ts` | HTTP. Exposes `POST /chat`, `GET /pods`, `GET /health`. Validates input, generates a request id, returns JSON. Depends **only** on the `PiClient` interface — never imports the SDK. |
| **SDK (Pi)** | `pi/types.ts`, `pi/realPiClient.ts` | The agent loop. `RealPiClient.runChat` builds a Pi `Agent`, registers the sandbox tools, runs one prompt turn (`agent.prompt`), and returns the final message + per-tool metadata. The **only** place the Pi SDK is used. |
| **Sandbox** | `sandbox/*`, `tools/*` | Pod execution + locking. `LeaseManager` leases a pod (FIFO queue, compare-and-swap on the `Lease`); `runInPod` execs in it via `kubectl`; `runInSandbox` brackets acquire→run→release; `tools/` are the 3 sandbox tools. |

Control flow: `POST /chat → server → PiClient.runChat → Agent loop → tool.execute → runInSandbox → LeaseManager + runInPod → kubectl`.

The two seams:
- **`PiClient` interface** hides the SDK from the server.
- **`AgentTool.execute`** is where the SDK's loop calls down into the sandbox.

## Prerequisites

- Bun, Docker, `kind`, `kubectl`
- A cluster: `kind create cluster --name pi-sandbox` (or reuse an existing one)
- An LLM API key (Gemini by default)

## Run

```bash
bun install

# 1. cluster: 8 pods + 8 leases
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-rbac.yaml
kubectl apply -f k8s/20-statefulset.yaml
kubectl apply -f k8s/30-leases.yaml
kubectl -n pi-sandbox rollout status statefulset/sandbox-runner

# 2. credentials
cp .env.example .env      # set GEMINI_API_KEY=...

# 3. run
bun start
```

```bash
# call it
curl localhost:3000/health
curl localhost:3000/pods | jq
curl -s -X POST localhost:3000/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"s1","message":"List the files in the sandbox."}' | jq
```

## Test the queue (no API key needed)

```bash
bun run test:leasing       # fires 9 concurrent tool calls; 8 lease, 9th queues
watch -n0.3 'kubectl -n pi-sandbox get leases'   # watch HOLDER fill to 8, never 9
```

## How leasing works

- Each pod has a `Lease` of the same name. A lease is the lock: `holderIdentity`
  empty = free.
- **Acquire** = `kubectl replace` the lease with our identity **and the observed
  `resourceVersion`** → compare-and-swap. A stale version → `Conflict` → try
  another pod. This is the optimistic concurrency.
- **FIFO queue**: when all 8 are held, callers wait (15s max) in
  `LeaseManager`'s queue, served oldest-first by a single `pump` loop. Timeout →
  `429 sandbox_capacity_timeout`.
- **Release** on every exit path (success / error / timeout), and only if we are
  still the holder.
- **Crash recovery**: a held lease carries `renewTime + 45s`. Once expired it
  counts as free, so a future request reclaims it — no manual cleanup.

## Tools

| Tool | Runs | Guard |
| --- | --- | --- |
| `shell.run` | allowlisted command (`pwd`, `ls`, `cat`, `whoami`, `node --version`) | program allowlist; argv exec'd directly (no shell); paths kept in `/workspace` |
| `fs.read` | `cat <file>` | path traversal / absolute escape rejected |
| `env.inspect` | fixed `node -e` script | non-user-controlled command |

## Production notes (brief)

Single replica → process-local FIFO is exact. For multiple replicas: move the
queue to a shared scheduler (Redis/NATS); the Lease still prevents double-booking.
Add lease renewal for long tools, audit logging, a hardened pod image, a
default-deny NetworkPolicy, and per-tenant limits.
