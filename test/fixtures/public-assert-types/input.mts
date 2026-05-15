import { assert } from "skillgym";

assert.equal(1, 1);
assert.commands.includes(null as never, "pnpm test");

// @ts-expect-error matcher should stay strongly typed
assert.commands.includes(null as never, 123);

// This must stay type-checked from the package export, not collapse to any.
// @ts-expect-error assert should not expose unknown methods
assert.notARealMethod();
