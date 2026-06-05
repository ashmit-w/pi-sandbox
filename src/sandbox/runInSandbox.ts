import { runInPod, type ExecResult } from "./runInPod";
import { manager, type Owner } from "./leaseManager";
import type { ToolCall } from "../pi/types";

/**
 * One tool call's lifecycle: lease a pod → run the command in it → ALWAYS
 * release. Records the pod + status into `recorder` for the chat response.
 */
export async function runInSandbox(
  owner: Owner,
  tool: string,
  recorder: ToolCall[],
  argv: string[],
): Promise<ExecResult> {
  const lease = await manager.acquire(owner); // FIFO-queued, 15s max wait
  const record: ToolCall = { toolCallId: owner.toolCallId, tool, pod: lease.podName, status: "completed" };
  recorder.push(record);
  try {
    return await runInPod(lease.podName, argv);
  } catch (e) {
    record.status = "failed";
    throw e;
  } finally {
    await lease.release(); // success, error, or timeout — always release
  }
}
