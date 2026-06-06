const ALLOWED = new Set(["pwd", "ls", "cat", "whoami", "node"]);
export const WORKDIR = process.env.SANDBOX_WORKDIR ?? "/workspace";

export function validateCommand(command: string): string[] {
  const argv = command.trim().split(/\s+/).filter(Boolean);
  const prog = argv[0];
  if (!prog) throw new Error("empty command");
  if (!ALLOWED.has(prog)) throw new Error(`command not allowed: ${prog}`);
  if (prog === "node" && argv[1] !== "--version") {
    throw new Error("node is restricted to --version");
  }
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("/") || arg.includes("..")) resolveInWorkdir(arg);
  }
  return argv;
}

export function resolveInWorkdir(path: string): string {
  const abs = path.startsWith("/") ? path : `${WORKDIR}/${path}`;
  const norm = normalize(abs);
  if (norm !== WORKDIR && !norm.startsWith(WORKDIR + "/")) {
    throw new Error(`path escapes ${WORKDIR}: ${path}`);
  }
  return norm;
}

function normalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}
