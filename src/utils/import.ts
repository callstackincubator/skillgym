import { pathToFileURL } from "node:url";

export async function importFromPath<T>(filePath: string): Promise<T> {
  return import(pathToFileURL(filePath).href) as Promise<T>;
}
