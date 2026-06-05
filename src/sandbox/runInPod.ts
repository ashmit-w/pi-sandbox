import { NS } from "./kubectl";

const CONTAINER = process.env.SANDBOX_CONTAINER ?? "runner";
const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS ?? 30_000);

export type ExecResult = { stdout: string; stderr: string; exitCode: number };

/** Run a command inside a pod via `kubectl exec`, with a timeout. */
export async function runInPod(podName: string, argv: string[]): Promise<ExecResult> {
  const proc = Bun.spawn(
    ["kubectl", "-n", NS, "exec", podName, "-c", CONTAINER, "--", ...argv],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), TOOL_TIMEOUT_MS);
  try {
    // Drain both streams concurrently so a full stderr pipe can't deadlock stdout.
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}
