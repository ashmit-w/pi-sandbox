import { runInPod, type ExecResult } from "./runInPod";
import { manager, type Owner } from "./leaseManager";
import type { ToolCall } from "../pi/types";

export async function runInSandbox(
  owner: Owner,
  tool: string,
  recorder: ToolCall[],
  argv: string[],
): Promise<ExecResult> {
  const lease = await manager.acquire(owner);
  const record: ToolCall = { toolCallId: owner.toolCallId, tool, pod: lease.podName, status: "completed" };
  recorder.push(record);
  try {
    return await runInPod(lease.podName, argv);
  } catch (e) {
    record.status = "failed";
    throw e;
  } finally {
    await lease.release();
  }
}
