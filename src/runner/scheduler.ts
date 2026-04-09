import type { ScheduleMode } from "../domain/schedule.js";

export interface PlannedExecution<TItem = unknown> {
  runnerId: string;
  item: TItem;
}

export async function scheduleExecutions<TItem>(
  executions: PlannedExecution<TItem>[],
  scheduleMode: ScheduleMode,
  execute: (execution: PlannedExecution<TItem>) => Promise<void>,
): Promise<void> {
  switch (scheduleMode) {
    case "serial":
      for (const execution of executions) {
        await execute(execution);
      }
      return;
    case "parallel":
      await Promise.all(executions.map((execution) => execute(execution)));
      return;
    case "isolated-by-runner": {
      const groups = groupByRunner(executions);
      await Promise.all(groups.map(async (group) => {
        for (const execution of group) {
          await execute(execution);
        }
      }));
      return;
    }
  }
}

function groupByRunner<TItem>(executions: PlannedExecution<TItem>[]): PlannedExecution<TItem>[][] {
  const groups = new Map<string, PlannedExecution<TItem>[]>();

  for (const execution of executions) {
    const group = groups.get(execution.runnerId);
    if (group === undefined) {
      groups.set(execution.runnerId, [execution]);
      continue;
    }

    group.push(execution);
  }

  return [...groups.values()];
}
