import process from "node:process";
import { expect, test } from "vitest";
import { execFileCapture } from "../../src/utils/process.ts";

test("execFileCapture mirrors stdout and stderr while still capturing both", async () => {
  const mirroredStdout: string[] = [];
  const mirroredStderr: string[] = [];

  const result = await execFileCapture(
    process.execPath,
    ["-e", "console.log('alpha'); console.error('beta');"],
    {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      mirror: {
        stdout: {
          write(chunk: string) {
            mirroredStdout.push(chunk);
            return true;
          },
        },
        stderr: {
          write(chunk: string) {
            mirroredStderr.push(chunk);
            return true;
          },
        },
      },
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("alpha");
  expect(result.stderr).toContain("beta");
  expect(mirroredStdout.join("")).toContain("alpha");
  expect(mirroredStderr.join("")).toContain("beta");
});

test("execFileCapture preserves UTF-8 characters split across stdout chunks", async () => {
  const result = await execFileCapture(
    process.execPath,
    [
      "-e",
      [
        "process.stdout.write(Buffer.from([0xF0, 0x9F]));",
        "setTimeout(() => process.stdout.write(Buffer.from([0x98, 0x80])), 10);",
        "setTimeout(() => process.exit(0), 20);",
      ].join(" "),
    ],
    {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("😀");
  expect(result.stderr).toBe("");
  expect(result.timedOut).toBe(false);
});

test("execFileCapture reports SIGKILL timeouts as timed out", async () => {
  const result = await execFileCapture(
    process.execPath,
    ["-e", "setTimeout(() => {}, 10000)"],
    {
      cwd: process.cwd(),
      timeoutMs: 50,
    },
  );

  expect(result.exitCode).toBeNull();
  expect(result.signal).toBe("SIGKILL");
  expect(result.timedOut).toBe(true);
});
