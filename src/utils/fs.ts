import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath: string, value: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, value, "utf8");
}

export async function removeDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}

export async function copyDir(sourceDir: string, destinationDir: string): Promise<void> {
  await ensureDir(path.dirname(destinationDir));
  await cp(sourceDir, destinationDir, {
    recursive: true,
    verbatimSymlinks: true,
    force: true,
  });
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  const fileStat = await stat(dirPath).catch(() => undefined);

  if (fileStat === undefined) {
    throw new Error(`Workspace template directory does not exist: ${dirPath}`);
  }

  if (!fileStat.isDirectory()) {
    throw new Error(`Workspace template path is not a directory: ${dirPath}`);
  }
}
