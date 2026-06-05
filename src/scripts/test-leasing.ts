// Concurrency test: fire 9 "tool calls" at once against 8 pods. Each pod stays
// busy ~2s (the sleep runs INSIDE the pod), so only 8 run at a time and the 9th
// queues until one frees. No LLM / API key needed — exercises the sandbox layer.
import { runInSandbox } from "../sandbox/runInSandbox";
import { manager } from "../sandbox/leaseManager";
import type { ToolCall } from "../pi/types";

const recorder: ToolCall[] = [];
const owner = (i: number) => ({
  instanceId: "api-1",
  requestId: `req-${i}`,
  sessionId: "s",
  toolCallId: `tc-${i}`,
});

const jobs = Array.from({ length: 9 }, (_, i) =>
  runInSandbox(owner(i), "shell.run", recorder, ["sh", "-c", "sleep 2; whoami"])
    .then(() => true)
    .catch(() => false),
);

await Bun.sleep(300);
console.log("queueDepth shortly after firing:", manager.queueDepth, "(drains as pods are claimed)");

const oks = await Promise.all(jobs);
const pods = recorder.map((r) => r.pod);
console.log(recorder);
console.log(
  `\nsucceeded: ${oks.filter(Boolean).length}/9 · ` +
    `distinct pods: ${new Set(pods).size} (max concurrency, should be 8) · ` +
    `total runs: ${pods.length} (the 9th reused a freed pod)`,
);
