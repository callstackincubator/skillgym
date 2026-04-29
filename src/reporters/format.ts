import prettyMs from "pretty-ms";
import stringWidth from "string-width";

const integerFormatter = new Intl.NumberFormat("en-US");

export function formatDuration(ms: number): string {
  return prettyMs(ms, {
    compact: false,
    secondsDecimalDigits: ms < 10_000 ? 1 : 0,
    unitCount: 2,
    verbose: false,
  });
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatInteger(value?: number): string {
  return value === undefined ? "-" : integerFormatter.format(Math.round(value));
}

export function formatTokens(value?: number): string {
  return value === undefined ? "-" : integerFormatter.format(Math.round(value));
}

export function formatRate(passed: number, total: number): string {
  return `${passed}/${total}`;
}

export function padCell(value: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(padding)}`;
}

export function visibleWidth(value: string): number {
  return stringWidth(value);
}

export function getSymbols(isUnicode: boolean): {
  pass: string;
  fail: string;
  bullet: string;
  warning: string;
} {
  if (isUnicode) {
    return {
      pass: "✓",
      fail: "✗",
      bullet: "•",
      warning: "⚠",
    };
  }

  return {
    pass: "OK",
    fail: "X",
    bullet: "-",
    warning: "!",
  };
}
