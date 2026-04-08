# Potential Improvements

## Workspace isolation

V1 runs retries directly against the target workspace.

A future version should support isolated retry environments, for example by:
- copying the workspace into a temporary directory per retry
- using a fixture repository
- using snapshot and restore mechanics

### Why this matters

Isolation would reduce:
- cross-retry state leakage
- accidental repo mutations
- flaky results caused by prior runs

### Tradeoffs

Isolation may increase:
- runtime
- disk usage
- implementation complexity
- complexity around large repositories

## Separate selection metrics

V1 reports only one metric: success rate.

A future version may split this into:
- skill pick rate
- assertion pass rate

This would help distinguish:
- skill selection failures
- execution correctness failures

## Claude adapter

Claude is out of scope for V1 and should be revisited later.

## Declarative assertions

V1 uses JavaScript assertions only.
A future version could add a declarative layer for simple cases.

## Better skill-selection evidence

Future versions may improve confidence scoring and explicit skill-load detection where runners expose it.

## Workspace fixtures

Future versions may support purpose-built test fixtures instead of running against the main working tree.

## Result comparison

Future versions may compare result sets across:
- different `SKILL.md` revisions
- different models
- different runners
