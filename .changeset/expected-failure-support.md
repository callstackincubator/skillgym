---
"skillgym": minor
---

Add `expectedFail` support for benchmark cases. Result `passed` values now represent expectation-aware suite health, with `status` exposing `passed`, `failed`, `expected-failed`, or `unexpected-passed` for reporters and CI consumers.
