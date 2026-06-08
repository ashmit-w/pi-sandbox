import { kubectl } from "./sandbox/kubectl";
import { listLeases, isFree, expiresAt } from "./sandbox/leases";

export async function getPodsState() {
  const [leases, ready] = await Promise.all([listLeases(), podReadiness()]);
  return leases.map((l) => ({
    name: l.name,
    ready: ready.get(l.name) ?? false,
    lease: isFree(l)
      ? { status: "free" as const }
      : { status: "leased" as const, holderIdentity: l.holder, expiresAt: expiresAt(l) },
  }));
}






export async function sandboxPodsReady(): Promise<number> {
  const ready = await podReadiness();
  return [...ready.values()].filter(Boolean).length;
}

async function podReadiness(): Promise<Map<string, boolean>> {
  const { out, ok } = await kubectl(["get", "pods", "-l", "app=sandbox-runner", "-o", "json"]);
  if (!ok) throw new Error("failed to read pods");
  const map = new Map<string, boolean>();
  for (const p of JSON.parse(out).items ?? []) {
    const name = p.metadata?.name;
    const isReady = (p.status?.conditions ?? []).some(
      (c: any) => c.type === "Ready" && c.status === "True",
    );
    if (name) map.set(name, isReady);
  }
  return map;
}
