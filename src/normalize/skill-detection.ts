import path from "node:path";
import type { SkillDetection } from "../domain/session-report.ts";

export function inferSkillsFromPaths(paths: string[]): SkillDetection[] {
  const detections = new Map<string, SkillDetection>();

  for (const filePath of paths) {
    if (!filePath.endsWith("SKILL.md")) {
      continue;
    }

    const parts = filePath.split(path.sep).filter(Boolean);
    const skill = parts.at(-2);

    if (skill === undefined) {
      continue;
    }

    const existing = detections.get(skill);

    if (existing !== undefined) {
      existing.evidence.push(`Read ${filePath}`);
      continue;
    }

    detections.set(skill, {
      skill,
      confidence: "strong",
      evidence: [`Read ${filePath}`],
    });
  }

  return [...detections.values()];
}
