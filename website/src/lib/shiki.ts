interface ColorInput {
  foreground: string;
  constant: string;
  string: string;
  comment: string;
  keyword: string;
  parameter: string;
  function: string;
  stringExpression: string;
  punctuation: string;
  link: string;
  number: string;
  property: string;
  highlight?: string;
  highlightHover?: string;
  highlightBorder?: string;
  diffDeleted?: string;
  diffInserted?: string;
}

interface TokenColor {
  name?: string;
  scope: string | string[];
  settings: {
    foreground?: string;
    fontStyle?: string;
    background?: string;
  };
}

interface ShikiTheme {
  name: string;
  type: "light" | "dark";
  colors: Record<string, string>;
  tokenColors: TokenColor[];
}

export function convertToShikiTheme(
  input: ColorInput,
  opts: { type: "light" | "dark"; background: string },
): ShikiTheme {
  return {
    name: `skillgym-${opts.type}`,
    type: opts.type,
    colors: {
      "editor.foreground": input.foreground,
      "editor.background": opts.background,
    },
    tokenColors: [
      // Base
      {
        scope: ["source", "text"],
        settings: { foreground: input.foreground },
      },
      // Comments
      {
        name: "Comment",
        scope: ["comment", "comment.line", "comment.block", "punctuation.definition.comment"],
        settings: { foreground: input.comment },
      },
      // Keywords: control flow, storage, modifiers
      {
        name: "Keyword",
        scope: [
          "keyword",
          "keyword.control",
          "keyword.control.flow",
          "keyword.control.import",
          "keyword.control.export",
          "keyword.control.from",
          "keyword.control.as",
          "keyword.operator.expression",
          "keyword.operator.new",
          "keyword.operator.typeof",
          "keyword.operator.instanceof",
          "keyword.operator.void",
          "keyword.operator.delete",
          "keyword.operator.in",
          "keyword.operator.of",
          "storage.type",
          "storage.modifier",
        ],
        settings: { foreground: input.keyword },
      },
      // Types, classes, interfaces, enums, namespaces
      {
        name: "Constant / Type",
        scope: [
          "entity.name.type",
          "entity.name.class",
          "entity.name.interface",
          "entity.name.enum",
          "entity.name.namespace",
          "entity.name.module",
          "entity.name.section",
          "support.class",
          "support.type",
          "variable.other.constant",
          "constant.other",
        ],
        settings: { foreground: input.constant },
      },
      // Function declarations and calls
      {
        name: "Function",
        scope: [
          "entity.name.function",
          "meta.function-call entity.name.function",
          "support.function",
          "variable.function",
        ],
        settings: { foreground: input.function },
      },
      // Function / method parameters
      {
        name: "Parameter",
        scope: [
          "variable.parameter",
          "entity.name.variable.parameter",
          "meta.function.parameter variable",
          "meta.parameters variable.other.readwrite",
        ],
        settings: { foreground: input.parameter },
      },
      // Strings
      {
        name: "String",
        scope: [
          "string",
          "string.quoted.single",
          "string.quoted.double",
          "string.quoted.other",
          "string.unquoted",
          "punctuation.definition.string.begin",
          "punctuation.definition.string.end",
        ],
        settings: { foreground: input.string },
      },
      // Template literals / string expressions
      {
        name: "String expression",
        scope: [
          "string.template",
          "meta.template.expression",
          "string.interpolated",
          "punctuation.definition.string.template.begin",
          "punctuation.definition.string.template.end",
          "meta.embedded.line",
        ],
        settings: { foreground: input.stringExpression },
      },
      // Numeric and language constants (true, false, null, undefined)
      {
        name: "Number / constant",
        scope: [
          "constant.numeric",
          "constant.other.color",
          "constant.language",
          "constant.language.boolean",
          "constant.language.null",
          "constant.language.undefined",
          "constant.language.nan",
        ],
        settings: { foreground: input.number },
      },
      // Object properties, HTML/JSX tags, object literal keys
      {
        name: "Property",
        scope: [
          "variable.other.property",
          "variable.other.object.property",
          "support.variable.property",
          "entity.name.tag",
          "meta.object-literal.key",
          "meta.object-literal.key string",
          "support.type.property-name",
        ],
        settings: { foreground: input.property },
      },
      // Punctuation (brackets, separators, accessors)
      {
        name: "Punctuation",
        scope: [
          "punctuation",
          "punctuation.separator",
          "punctuation.terminator",
          "punctuation.accessor",
          "meta.brace.round",
          "meta.brace.square",
          "meta.brace.curly",
          "punctuation.definition.block",
          "punctuation.definition.parameters.begin",
          "punctuation.definition.parameters.end",
        ],
        settings: { foreground: input.punctuation },
      },
      // Operators
      {
        name: "Operator",
        scope: [
          "keyword.operator",
          "keyword.operator.arithmetic",
          "keyword.operator.assignment",
          "keyword.operator.comparison",
          "keyword.operator.logical",
          "keyword.operator.bitwise",
          "keyword.operator.ternary",
          "keyword.operator.spread",
          "keyword.operator.type",
          "keyword.operator.optional",
        ],
        settings: { foreground: input.punctuation },
      },
      // Regex
      {
        name: "Regex",
        scope: [
          "string.regexp",
          "source.regexp",
          "string.regexp.character-class",
          "string.regexp constant.character.escape",
        ],
        settings: { foreground: input.string },
      },
      // Links
      {
        name: "Link",
        scope: ["markup.underline.link", "string.other.link"],
        settings: { foreground: input.link },
      },
    ],
  };
}

export const lightTheme = convertToShikiTheme(
  {
    foreground: "hsla(0, 0%, 9%,1)",
    constant: "oklch(53.18% 0.2399 256.9900584162342)",
    string: "oklch(51.75% 0.1453 147.65)",
    comment: "hsla(0, 0%, 40%,1)",
    keyword: "oklch(53.5% 0.2058 2.84)",
    parameter: "oklch(52.79% 0.1496 54.65)",
    function: "oklch(47.18% 0.2579 304)",
    stringExpression: "oklch(51.75% 0.1453 147.65)",
    punctuation: "hsla(0, 0%, 9%,1)",
    link: "oklch(51.75% 0.1453 147.65)",
    number: "#111111",
    property: "oklch(53.18% 0.2399 256.9900584162342)",
    highlight: "oklch(94.58% 0.0293 249.84870859673202)",
    highlightHover: "oklch(94.58% 0.0293 249.84870859673202 / 30%)",
    highlightBorder: "oklch(53.18% 0.2399 256.9900584162342)",
    diffDeleted: "oklch(58.01% 0.227 25.12)",
    diffInserted: "oklch(57.81% 0.1776 147.5)",
  },
  { type: "light", background: "#ffffff" },
);

export const darkTheme = convertToShikiTheme(
  {
    foreground: "hsla(0, 0%, 93%,1)",
    constant: "oklch(71.7% 0.1648 250.79360374054167)",
    string: "oklch(73.1% 0.2158 148.29)",
    comment: "hsla(0, 0%, 63%,1)",
    keyword: "oklch(69.36% 0.2223 3.91)",
    parameter: "oklch(77.21% 0.1991 64.28)",
    function: "oklch(69.87% 0.2037 309.51)",
    stringExpression: "oklch(73.1% 0.2158 148.29)",
    punctuation: "hsla(0, 0%, 93%,1)",
    link: "oklch(73.1% 0.2158 148.29)",
    number: "#ffffff",
    property: "oklch(71.7% 0.1648 250.79360374054167)",
    highlight: "oklch(30.86% 0.1022 255.21)",
    highlightHover: "oklch(30.86% 0.1022 255.21 / 30%)",
    highlightBorder: "oklch(71.7% 0.1648 250.79360374054167)",
    diffDeleted: "oklch(62.56% 0.2277 23.03)",
    diffInserted: "oklch(58.11% 0.1815 146.55)",
  },
  { type: "dark", background: "#0D0D10" },
);
