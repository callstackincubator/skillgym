# skillgym

## 0.9.0

### Minor Changes

- [#34](https://github.com/callstackincubator/skillgym/pull/34) [`2693d64`](https://github.com/callstackincubator/skillgym/commit/2693d6483fef890ca35f92689ddbafd44137c908) Thanks [@V3RON](https://github.com/V3RON)! - Use Commander for argv parsing.

- [#36](https://github.com/callstackincubator/skillgym/pull/36) [`aa653cf`](https://github.com/callstackincubator/skillgym/commit/aa653cfcaf1fc36ffc9bbf92ae3d262c06782300) Thanks [@CAMOBAP](https://github.com/CAMOBAP)! - Add built-in HTML reporter.

- [#40](https://github.com/callstackincubator/skillgym/pull/40) [`a668d40`](https://github.com/callstackincubator/skillgym/commit/a668d40627847b224e6a32a5663a5bdf74b1bacf) Thanks [@V3RON](https://github.com/V3RON)! - Allow shared workspace bootstrap setup.

### Patch Changes

- [#42](https://github.com/callstackincubator/skillgym/pull/42) [`ac9dda4`](https://github.com/callstackincubator/skillgym/commit/ac9dda4afee0491f8b86f27497cd92dc90eb256f) Thanks [@V3RON](https://github.com/V3RON)! - Fix OpenCode artifact collection.

- [#41](https://github.com/callstackincubator/skillgym/pull/41) [`5907944`](https://github.com/callstackincubator/skillgym/commit/590794438323c71bb5480366e73b7d635d8d306a) Thanks [@V3RON](https://github.com/V3RON)! - Normalize Skillgym casing across docs and APIs.

- [#39](https://github.com/callstackincubator/skillgym/pull/39) [`9facf01`](https://github.com/callstackincubator/skillgym/commit/9facf0165362930434e364a9c74c10f44265bf9d) Thanks [@V3RON](https://github.com/V3RON)! - Fix public assert typings.

- [#38](https://github.com/callstackincubator/skillgym/pull/38) [`99608d0`](https://github.com/callstackincubator/skillgym/commit/99608d0477fab04ebcff8a9a863c9fa59395b23a) Thanks [@V3RON](https://github.com/V3RON)! - Fix explain artifact path resolution.

- [#37](https://github.com/callstackincubator/skillgym/pull/37) [`e59f808`](https://github.com/callstackincubator/skillgym/commit/e59f808b43b6f187ad401aaa5810e775de910989) Thanks [@V3RON](https://github.com/V3RON)! - Fix README config example syntax.

- [#35](https://github.com/callstackincubator/skillgym/pull/35) [`7db9dd3`](https://github.com/callstackincubator/skillgym/commit/7db9dd3179af56cf43c4716cbeea171adce8ed25) Thanks [@V3RON](https://github.com/V3RON)! - chore: pin GitHub Actions workflows.

## 0.8.1

### Patch Changes

- [#33](https://github.com/callstackincubator/skillgym/pull/33) [`dcb7863`](https://github.com/callstackincubator/skillgym/commit/dcb7863d9cb6d3a5ae900a0479d3ef63bd65ba48) Thanks [@V3RON](https://github.com/V3RON)! - Raise the process max listener limit during a suite run based on `maxParallel`, then restore the original limit afterward.

- [#32](https://github.com/callstackincubator/skillgym/pull/32) [`4793b75`](https://github.com/callstackincubator/skillgym/commit/4793b7507ae8d569a2b80c816725c44274acedd0) Thanks [@V3RON](https://github.com/V3RON)! - Restore `TestCase` and `TestSuite` as public type aliases from the package root so existing suite files keep compiling after the vocabulary normalization.

## 0.7.0

### Minor Changes

- [#19](https://github.com/callstackincubator/skillgym/pull/19) [`ae5aed5`](https://github.com/callstackincubator/skillgym/commit/ae5aed524592b954be6225d4d47d16e3bbcd35f4) Thanks [@V3RON](https://github.com/V3RON)! - Classify assertion failures (for example timeouts vs expectation mismatches) and show the kind in standard, JSON summary, and GitHub Actions output.

- [#20](https://github.com/callstackincubator/skillgym/pull/20) [`39393cc`](https://github.com/callstackincubator/skillgym/commit/39393cc07cb22ce713e35f9fc2dd86b56a4ffa19) Thanks [@V3RON](https://github.com/V3RON)! - Add soft assertions so a case can record multiple failures and report them together instead of stopping at the first one.

## 0.6.0

### Minor Changes

- [#10](https://github.com/callstackincubator/skillgym/pull/10) [`adb3708`](https://github.com/callstackincubator/skillgym/commit/adb3708a8cb234b79f3acd6356c6f249736363ea) Thanks [@V3RON](https://github.com/V3RON)! - You can now mark known failures so expected problems do not block a run.

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - You can now filter benchmark executions by tag.

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - Asserting on commands is now easier and more reliable.

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - You can now view benchmark results in JSON or GitHub Actions.

### Patch Changes

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - Skillgym now handles invalid models more smoothly.

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - Skillgym now tracks Cursor file reads more reliably.

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - Benchmark suites now use available CPU capacity more efficiently.

- [`ff92fea`](https://github.com/callstackincubator/skillgym/commit/ff92fea9a4c316729ecb4e21ba2b3909e9ff82f1) Thanks [@V3RON](https://github.com/V3RON)! - The basic example now includes the latest max-steps case.
