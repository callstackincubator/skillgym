# Skill Detection

## Purpose

V1 needs to observe whether a skill was likely selected during a run.

This should be treated as evidence, not certainty.

## Why this is separate

Skill selection is a major use case of the project, but runners do not expose it uniformly.

A single `selected: true` field would be misleading.

## Evidence levels

### `explicit`

Use when the runner provides a direct signal that a named skill was loaded.

### `strong`

Use when the transcript or event stream clearly states that the agent is using a specific skill, or when the skill's `SKILL.md` is read directly during the run.

### `medium`

Use when the agent reads files strongly associated with the skill, but the run never explicitly names the skill.

### `weak`

Use when there is only indirect textual evidence.

## Evidence examples

Strong signals:
- assistant message explicitly says it will use a named skill
- direct read of `<skill>/SKILL.md`
- explicit skill-load event in exported session data

Medium signals:
- read of a known skill-owned helper file
- commands strongly tied to a skill workflow, without explicit naming

Weak signals:
- vague textual references that could match multiple skills

## V1 rule

Assertions may rely on inferred skill detection, but the report must preserve the evidence and confidence level so failures can be debugged honestly.
