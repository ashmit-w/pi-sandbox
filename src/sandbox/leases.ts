import { kubectl, NS } from "./kubectl";

export const TTL = Number(process.env.LEASE_TTL_SECONDS ?? 45);

export type Lease = {
  name: string;
  holder: string;
  renewTime?: string;
  resourceVersion: string;
};

export async function listLeases(): Promise<Lease[]> {
  const { out, ok } = await kubectl(["get", "leases", "-o", "json"]);
  if (!ok) throw new Error("failed to list leases");
  return JSON.parse(out).items.map((l: any) => ({
    name: l.metadata.name,
    holder: l.spec?.holderIdentity ?? "",
    renewTime: l.spec?.renewTime,
    resourceVersion: l.metadata.resourceVersion,
  }));
}

export function isFree(l: Lease): boolean {
  if (!l.holder) return true;
  if (!l.renewTime) return false;
  return Date.now() > new Date(l.renewTime).getTime() + TTL * 1000;
}

export function expiresAt(l: Lease): string | undefined {
  if (!l.holder || !l.renewTime) return undefined;
  return new Date(new Date(l.renewTime).getTime() + TTL * 1000).toISOString();
}

export async function setHolder(l: Lease, holder: string): Promise<boolean> {
  const manifest = JSON.stringify({
    apiVersion: "coordination.k8s.io/v1",
    kind: "Lease",
    metadata: { name: l.name, namespace: NS, resourceVersion: l.resourceVersion },
    spec: { holderIdentity: holder, leaseDurationSeconds: TTL, renewTime: microNow() },
  });
  const { ok } = await kubectl(["replace", "-f", "-"], manifest);
  return ok;
}

function microNow(): string {
  return new Date().toISOString().replace("Z", "000Z");
}
