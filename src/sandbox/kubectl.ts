export const NS = process.env.SANDBOX_NAMESPACE ?? "pi-sandbox";

export async function kubectl(
  args: string[],
  stdin?: string,
): Promise<{ out: string; err: string; ok: boolean }> {
  const proc = Bun.spawn(["kubectl", "-n", NS, ...args], {
    stdin: stdin ? new Blob([stdin]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const ok = (await proc.exited) === 0;
  return { out, err, ok };
}
