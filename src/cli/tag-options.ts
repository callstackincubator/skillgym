/** Accumulate raw `--tag` values (comma-splitting happens in {@link parseTagOption}). Commander passes `(value, previous)`. */
export function accumulateTagOptionValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function parseTagOption(
  value: string | boolean | string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    throw new Error("CLI option --tag requires a non-empty value.");
  }

  const values = Array.isArray(value) ? value : [value];
  const tags = values.flatMap((item) => item.split(",").map((tag) => tag.trim()));

  if (tags.some((tag) => tag.length === 0)) {
    throw new Error("CLI option --tag requires non-empty comma-separated values.");
  }

  return [...new Set(tags)];
}
