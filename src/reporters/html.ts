import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseResult, RunnerResult, SuiteRunResult } from "../domain/result.js";
import type { Case } from "../domain/case.js";
import type { SessionEvent } from "../domain/session-report.js";
import type { BenchmarkReporter, CaseFinishEvent } from "./contract.js";

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ms(n: number | undefined): string {
  if (n == null) return "—";
  return n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`;
}

function tokens(n: number | undefined): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function renderEvent(e: SessionEvent): string {
  if (e.type === "message" && e.role === "assistant") {
    return `<details><summary>assistant message</summary><pre>${esc(e.text)}</pre></details>`;
  }
  if (e.type === "toolCall") {
    const args = e.args ? JSON.stringify(e.args, null, 2) : "";
    return `<details><summary>tool: ${esc(e.tool)}</summary><pre>${esc(args)}</pre></details>`;
  }
  if (e.type === "fileRead") {
    return `<p>read: <code>${esc(e.path)}</code></p>`;
  }
  if (e.type === "command") {
    return `<p>cmd: <code>${esc(e.command)}</code></p>`;
  }
  return "";
}

function renderRunnerBlock(rr: RunnerResult): string {
  const report = rr.report;
  const statusLabel = rr.passed ? "PASS" : "FAIL";
  const runnerId = rr.runner?.id ?? "unknown";
  const eventsHtml = (report?.events ?? []).map(renderEvent).join("\n");
  const errorHtml = rr.error
    ? `<pre>${esc(rr.error.message)}\n${esc(rr.error.stack ?? "")}</pre>`
    : "";
  const finalOutput = report?.finalOutput
    ? `<details><summary>final output</summary><pre>${esc(report.finalOutput)}</pre></details>`
    : "";

  return `
    <section>
      <h3>${esc(runnerId)} — ${statusLabel} — ${ms(rr.durationMs)}
        &nbsp; in: ${tokens(report?.usage?.inputTokens)} / out: ${tokens(report?.usage?.outputTokens)}
      </h3>
      ${errorHtml}
      ${finalOutput}
      ${eventsHtml}
    </section>`;
}

function renderCaseSection(testCase: Case, caseResult: CaseResult): string {
  const status = caseResult.passed ? "✓" : "✗";
  const runnerBlocks = (caseResult.runnerResults ?? [])
    .filter(Boolean)
    .map(renderRunnerBlock)
    .join("\n");

  return `
    <details>
      <summary><strong>${status} ${esc(testCase.id)}</strong></summary>
      <blockquote><pre>${esc(testCase.prompt)}</pre></blockquote>
      ${runnerBlocks}
    </details>`;
}

function renderPage(result: SuiteRunResult, caseSections: string): string {
  const passed = result.cases.filter((c) => c.passed).length;
  const total = result.cases.length;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>skillgym — ${esc(result.suitePath)}</title>
      <style>
        body { font-family: monospace; margin: 2em; }
        pre { white-space: pre-wrap; word-break: break-word; background: #f4f4f4; padding: 0.5em; }
        summary { cursor: pointer; }
        blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 1em; }
        h3 { margin: 0.5em 0; font-size: 1em; }
        section { margin-left: 1em; border-left: 2px solid #eee; padding-left: 1em; }
      </style>
    </head>
    <body>
      <h1>skillgym report</h1>
      <p>${esc(result.suitePath)}</p>
      <p>${passed}/${total} passed &nbsp; ${ms(result.durationMs)}</p>
      <hr>
      ${caseSections}
    </body>
    </html>`;
}

export function createHtmlReporter(): BenchmarkReporter {
  const caseResults: CaseFinishEvent[] = [];

  return {
    onCaseFinish(event) {
      caseResults.push(event);
    },

    onSuiteFinish(event) {
      try {
        const { result } = event;
        const caseSections = caseResults
          .map((ev) => renderCaseSection(ev.case, ev.result))
          .join("\n");
        const html = renderPage(result, caseSections);
        const outPath = join(result.suiteRunArtifactDir, "report.html");
        writeFileSync(outPath, html, "utf-8");
        console.log(`\nHTML report: ${outPath}\n`);
      } catch (err) {
        console.error("html-reporter error:", err);
      }
    },
  };
}
