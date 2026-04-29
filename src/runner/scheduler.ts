import type { ScheduleMode } from "../domain/schedule.js";

export interface PlannedExecution<TItem = unknown> {
  runnerId: string;
  item: TItem;
}

export async function scheduleExecutions<TItem>(
  executions: PlannedExecution<TItem>[],
  scheduleMode: ScheduleMode,
  maxParallel: number,
  execute: (execution: PlannedExecution<TItem>) => Promise<void>,
): Promise<void> {
  switch (scheduleMode) {
    case "serial":
      for (const execution of executions) {
        await execute(execution);
      }
      return;
    case "parallel":
      await runWithConcurrencyLimit(executions, maxParallel, execute);
      return;
    case "isolated-by-runner": {
      const groups = groupByRunner(executions);
      await runWithConcurrencyLimit(groups, maxParallel, async (group) => {
        for (const execution of group) {
          await execute(execution);
        }
      });
      return;
    }
  }
}

async function runWithConcurrencyLimit<TItem>(
  items: TItem[],
  maxParallel: number,
  run: (item: TItem) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.min(maxParallel, items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;

        const item = items[index];
        if (item === undefined) {
          return;
        }

        await run(item);
      }
    }),
  );
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
