import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type TestCase } from "../src/index.js";

const counterDir = path.join(os.tmpdir(), "skillgym-repeat-counter-suite");
const stableCounterPath = path.join(counterDir, "stable.json");
const flakyCounterPath = path.join(counterDir, "flaky.json");

mkdirSync(counterDir, { recursive: true });
writeFileSync(stableCounterPath, JSON.stringify({ value: 0 }, null, 2), "utf8");
writeFileSync(flakyCounterPath, JSON.stringify({ value: 0 }, null, 2), "utf8");

const suite: TestCase[] = [
  {
    id: "repeat-counter-stable",
    prompt: "Say only: stable repeat counter demo",
    async assert() {
      const next = await incrementCounter(stableCounterPath);
      console.log(next);
    },
  },
  {
    id: "repeat-counter-flaky",
    prompt: "Say only: flaky repeat counter demo",
    async assert() {
      const next = await incrementCounter(flakyCounterPath);
      console.log(next);

      if (next === 3 || next === 4) {
        throw new Error(`intentional failure at counter ${String(next)}`);
      }
    },
  },
];

export default suite;
export { counterDir, stableCounterPath, flakyCounterPath };

async function incrementCounter(filePath: string): Promise<number> {
  const current = await readCounter(filePath);
  const next = current + 1;
  await writeFile(filePath, JSON.stringify({ value: next }, null, 2), "utf8");
  return next;
}

async function readCounter(filePath: string): Promise<number> {
  const contents = JSON.parse(await readFile(filePath, "utf8")) as { value?: unknown };
  if (typeof contents.value !== "number") {
    throw new Error(`Invalid counter file: ${filePath}`);
  }

  return contents.value;
}
