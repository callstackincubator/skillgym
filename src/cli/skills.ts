import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_FILE_EXTENSION = ".md";

export function listBundledSkills(): string[] {
  return readdirSync(resolveSkillsDir())
    .filter((entry) => entry.endsWith(SKILL_FILE_EXTENSION))
    .map((entry) => entry.slice(0, -SKILL_FILE_EXTENSION.length))
    .sort();
}

export function readBundledSkill(name: string): string {
  if (!/^[a-z0-9-]+$/i.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }

  const filePath = path.join(resolveSkillsDir(), `${name}${SKILL_FILE_EXTENSION}`);

  if (!existsSync(filePath)) {
    throw new Error(`Unknown bundled skill: ${name}`);
  }

  return readFileSync(filePath, "utf8");
}

function resolveSkillsDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "skills"),
    path.resolve(moduleDir, "..", "skills"),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, `core${SKILL_FILE_EXTENSION}`))) {
      return candidate;
    }
  }

  throw new Error("Could not locate bundled skills directory.");
}
