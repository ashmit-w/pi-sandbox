import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { runInSandbox } from "../sandbox/runInSandbox";
import type { Owner } from "../sandbox/leaseManager";
import type { ToolCall } from "../pi/types";
import { validateCommand, resolveInWorkdir, WORKDIR } from "./security";

export function createTools(recorder: ToolCall[], base: Omit<Owner, "toolCallId">): AgentTool[] {
  const owner = (toolCallId: string): Owner => ({ ...base, toolCallId });

  const shellRun: AgentTool = {
    name: "shell_run",
    label: "Run shell command",
    description:
      `Run an allowlisted command inside the sandbox: pwd, ls, cat <path>, whoami, node --version. Paths must stay within ${WORKDIR}.`,
    parameters: Type.Object({
      command: Type.String({ description: 'e.g. "ls -la" or "node --version"' }),
    }),
    execute: async (toolCallId, raw) => {
      const { command } = raw as { command: string };
      const argv = validateCommand(command);
      const { stdout, stderr, exitCode } = await runInSandbox(owner(toolCallId), "shell.run", recorder, argv);
      const text = (stdout || stderr).trimEnd() + (exitCode !== 0 ? `\n(exit ${exitCode})` : "");
      return { content: [{ type: "text", text }], details: { command, exitCode } };
    },
  };

  const fsRead: AgentTool = {
    name: "fs_read",
    label: "Read a file",
    description:
      `Read a file from inside the sandbox. Restricted to ${WORKDIR}; path traversal and absolute escapes are rejected.`,
    parameters: Type.Object({
      path: Type.String({ description: "file path within the sandbox workdir" }),
    }),
    execute: async (toolCallId, raw) => {
      const { path } = raw as { path: string };
      const safe = resolveInWorkdir(path); 
      const { stdout, stderr, exitCode } = await runInSandbox(owner(toolCallId), "fs.read", recorder, ["cat", safe]);
      if (exitCode !== 0) throw new Error(`could not read ${safe}: ${stderr.trim() || "non-zero exit"}`);
      return { content: [{ type: "text", text: stdout }], details: { path: safe, bytes: stdout.length } };
    },
  };

  const envInspect: AgentTool = {
    name: "env_inspect",
    label: "Inspect runtime",
    description:
      "Report the sandbox pod's name, namespace, working directory, user, and runtime versions.",
    parameters: Type.Object({}),
    execute: async (toolCallId) => {
      const script =
        "const os=require('os');console.log(JSON.stringify({" +
        "podName:process.env.POD_NAME||os.hostname()," +
        "namespace:process.env.POD_NAMESPACE||null," +
        "workingDirectory:process.cwd()," +
        "user:os.userInfo().username," +
        "nodeVersion:process.version," +
        "platform:process.platform+' '+os.release()," +
        "arch:process.arch}));";
      const { stdout, stderr, exitCode } = await runInSandbox(owner(toolCallId), "env.inspect", recorder, ["node", "-e", script]);
      if (exitCode !== 0) throw new Error(`env.inspect failed: ${stderr.trim() || "non-zero exit"}`);
      const info = JSON.parse(stdout.trim());
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }], details: info };
    },
  };

  return [shellRun, fsRead, envInspect];
}
