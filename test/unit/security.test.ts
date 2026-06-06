import { describe, it, expect } from "bun:test";
import { validateCommand, resolveInWorkdir } from "../../src/tools/security";

// ─── validateCommand ────────────────────────────────────────────────────────

describe("validateCommand – allowed commands", () => {
  it("1. pwd returns ['pwd']", () => {
    expect(validateCommand("pwd")).toEqual(["pwd"]);
  });

  it("2. ls returns ['ls']", () => {
    expect(validateCommand("ls")).toEqual(["ls"]);
  });

  it("3. ls -la returns ['ls', '-la']", () => {
    expect(validateCommand("ls -la")).toEqual(["ls", "-la"]);
  });

  it("4. cat file.txt returns ['cat', 'file.txt']", () => {
    expect(validateCommand("cat file.txt")).toEqual(["cat", "file.txt"]);
  });

  it("5. whoami returns ['whoami']", () => {
    expect(validateCommand("whoami")).toEqual(["whoami"]);
  });

  it("6. node --version returns ['node', '--version']", () => {
    expect(validateCommand("node --version")).toEqual(["node", "--version"]);
  });

  it("7. leading/trailing whitespace is stripped", () => {
    expect(validateCommand("  pwd  ")).toEqual(["pwd"]);
  });

  it("8. multiple spaces between args are collapsed", () => {
    expect(validateCommand("ls  -la")).toEqual(["ls", "-la"]);
  });

  it("9. cat with in-workdir path is accepted", () => {
    expect(validateCommand("cat /workspace/file.txt")).toEqual(["cat", "/workspace/file.txt"]);
  });

  it("10. ls with workdir subpath is accepted", () => {
    expect(validateCommand("ls -la /workspace/subdir")).toEqual(["ls", "-la", "/workspace/subdir"]);
  });
});

describe("validateCommand – blocked commands", () => {
  it("11. rm throws 'command not allowed'", () => {
    expect(() => validateCommand("rm -rf /")).toThrow("command not allowed: rm");
  });

  it("12. curl throws 'command not allowed'", () => {
    expect(() => validateCommand("curl http://evil.com")).toThrow("command not allowed: curl");
  });

  it("13. bash throws 'command not allowed'", () => {
    expect(() => validateCommand("bash -c cmd")).toThrow("command not allowed: bash");
  });

  it("14. sh throws 'command not allowed'", () => {
    expect(() => validateCommand("sh")).toThrow("command not allowed: sh");
  });

  it("15. /bin/sh throws 'command not allowed'", () => {
    expect(() => validateCommand("/bin/sh")).toThrow("command not allowed: /bin/sh");
  });

  it("16. python throws 'command not allowed'", () => {
    expect(() => validateCommand("python -c 'import os'")).toThrow("command not allowed: python");
  });

  it("17. node without --version throws", () => {
    expect(() => validateCommand("node")).toThrow();
  });

  it("18. node -e 'code' throws (not --version)", () => {
    expect(() => validateCommand("node -e 'process.exit(1)'")).toThrow("node is restricted to --version");
  });

  it("19. node --version is allowed even with extra args (argv[1] check only)", () => {
    // security.ts only checks argv[1] === "--version"; extra trailing args pass through
    expect(validateCommand("node --version --inspect")).toEqual(["node", "--version", "--inspect"]);
  });
});

describe("validateCommand – empty input", () => {
  it("20. empty string throws 'empty command'", () => {
    expect(() => validateCommand("")).toThrow("empty command");
  });

  it("21. whitespace-only string throws 'empty command'", () => {
    expect(() => validateCommand("   ")).toThrow("empty command");
  });
});

describe("validateCommand – path traversal in args", () => {
  it("22. cat /etc/passwd throws (absolute path outside workdir)", () => {
    expect(() => validateCommand("cat /etc/passwd")).toThrow();
  });

  it("23. cat ../../etc/shadow throws (traversal)", () => {
    expect(() => validateCommand("cat ../../etc/shadow")).toThrow();
  });

  it("24. ls .. throws (traversal)", () => {
    expect(() => validateCommand("ls ..")).toThrow();
  });
});

// ─── resolveInWorkdir ────────────────────────────────────────────────────────

describe("resolveInWorkdir – valid paths", () => {
  it("25. relative 'file.txt' → '/workspace/file.txt'", () => {
    expect(resolveInWorkdir("file.txt")).toBe("/workspace/file.txt");
  });

  it("26. relative 'sub/file.txt' → '/workspace/sub/file.txt'", () => {
    expect(resolveInWorkdir("sub/file.txt")).toBe("/workspace/sub/file.txt");
  });

  it("27. absolute '/workspace/file.txt' → '/workspace/file.txt'", () => {
    expect(resolveInWorkdir("/workspace/file.txt")).toBe("/workspace/file.txt");
  });

  it("28. '/workspace' itself is valid → '/workspace'", () => {
    expect(resolveInWorkdir("/workspace")).toBe("/workspace");
  });

  it("29. '/workspace/a/b' → '/workspace/a/b'", () => {
    expect(resolveInWorkdir("/workspace/a/b")).toBe("/workspace/a/b");
  });

  it("30. '/workspace/a/../b' normalises to '/workspace/b'", () => {
    expect(resolveInWorkdir("/workspace/a/../b")).toBe("/workspace/b");
  });

  it("31. '/workspace/a/b/../../c' normalises to '/workspace/c'", () => {
    expect(resolveInWorkdir("/workspace/a/b/../../c")).toBe("/workspace/c");
  });

  it("32. empty string resolves to '/workspace'", () => {
    expect(resolveInWorkdir("")).toBe("/workspace");
  });

  it("33. '.' resolves to '/workspace'", () => {
    expect(resolveInWorkdir(".")).toBe("/workspace");
  });
});

describe("resolveInWorkdir – rejected paths", () => {
  it("34. '/tmp' throws (outside workdir)", () => {
    expect(() => resolveInWorkdir("/tmp")).toThrow();
  });

  it("35. '/etc/passwd' throws", () => {
    expect(() => resolveInWorkdir("/etc/passwd")).toThrow();
  });

  it("36. '../../etc' throws (traversal from workdir)", () => {
    expect(() => resolveInWorkdir("../../etc")).toThrow();
  });
});