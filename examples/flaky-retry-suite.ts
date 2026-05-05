import { access, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert, type TestCase } from "skillgym";

const markerPath = path.join(os.tmpdir(), "skillgym-flaky-retry-example-6.marker");

const suite: TestCase[] = [
  {
    id: "retry-once",
    prompt: "Reply exactly: skillgym retry example",
    async assert(_report, ctx) {
      try {
        await access(markerPath);
      } catch {
        await writeFile(markerPath, "seen", "utf8");
        throw new Error("Intentional first-run failure. Run the same suite again.");
      }

      assert.match(ctx.finalOutput(), /skillgym retry example/i);
    },
  },
];

export default suite;
