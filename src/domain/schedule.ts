export const SCHEDULE_MODES = ["serial", "parallel", "isolated-by-runner"] as const;

export type ScheduleMode = typeof SCHEDULE_MODES[number];
