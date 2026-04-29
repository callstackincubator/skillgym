import path from "node:path";

export function resolveReportedPath(
  rawPath: string | undefined,
  baseDir: string,
): string | undefined {
  const candidate = rawPath?.trim();
  if (candidate === undefined || candidate.length === 0) {
    return undefined;
  }

  return path.isAbsolute(candidate) ? path.normalize(candidate) : path.resolve(baseDir, candidate);
}
