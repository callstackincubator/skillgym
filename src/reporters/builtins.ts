export const BUILT_IN_REPORTER_NAMES = ["standard", "json", "github-actions"] as const;

export type BuiltInReporterName = typeof BUILT_IN_REPORTER_NAMES[number];

export function isBuiltInReporter(value: string): value is BuiltInReporterName {
  return BUILT_IN_REPORTER_NAMES.includes(value as BuiltInReporterName);
}
