'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Schema annotation tag names recognized in comments.
 * @type {ReadonlySet<string>}
 */
const SCHEMA_TAGS = new Set([
  'type', 'required', 'optional', 'default',
  'description', 'pattern', 'min', 'max',
]);

/**
 * @typedef {Object} EnvEntry
 * @property {string}   key       — The variable name
 * @property {string}   value     — The resolved value (quotes stripped, escape sequences handled)
 * @property {number}   line      — 1-based line number where the key appears
 * @property {string}   rawLine   — The original untouched line text
 * @property {string[]} comments  — Preceding comment lines (without the leading `#`)
 */

/**
 * @typedef {Object} SchemaAnnotation
 * @property {string}  [type]        — Expected type: string|number|boolean|url|email|port|enum(val1,val2)
 * @property {boolean} [required]    — Whether the variable is required
 * @property {boolean} [optional]    — Whether the variable is optional
 * @property {string}  [default]     — Default value
 * @property {string}  [description] — Human-readable description
 * @property {string}  [pattern]     — Regex pattern the value must match
 * @property {number}  [min]         — Minimum numeric value
 * @property {number}  [max]         — Maximum numeric value
 */

/**
 * @typedef {Object} ParseResult
 * @property {EnvEntry[]}                       entries — Parsed variable entries
 * @property {Record<string, SchemaAnnotation>} schema  — Per-key schema annotations
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip matching surrounding quotes from a value string.
 * Handles double-quotes, single-quotes, and backticks.
 *
 * @param {string} raw — The raw value text
 * @returns {string} The unquoted value
 */
function stripQuotes(raw) {
  if (raw.length < 2) return raw;

  const first = raw[0];
  const last = raw[raw.length - 1];

  if ((first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`')) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * Process escape sequences inside a double-quoted value.
 *
 * @param {string} val — Value with potential escape sequences
 * @returns {string} The processed string
 */
function processEscapes(val) {
  return val
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/**
 * Detect whether a value starts a multiline quoted block.
 * A multiline block begins with an opening quote that is NOT closed on the
 * same line.
 *
 * @param {string} raw — The raw value portion after `=`
 * @returns {{ isMultiline: boolean, quoteChar: string }}
 */
function detectMultiline(raw) {
  if (raw.length === 0) return { isMultiline: false, quoteChar: '' };

  const first = raw[0];
  if (first !== '"' && first !== "'" && first !== '`') {
    return { isMultiline: false, quoteChar: '' };
  }

  // Look for a matching closing quote (ignoring escaped quotes)
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === '\\' && first === '"') {
      i++; // skip next char
      continue;
    }
    if (raw[i] === first) {
      // Closing quote found — NOT multiline
      return { isMultiline: false, quoteChar: '' };
    }
  }

  // No closing quote on this line → multiline
  return { isMultiline: true, quoteChar: first };
}

/**
 * Parse schema annotation tags from a block of comment lines.
 *
 * Recognized tags:
 * - `@type <type>`
 * - `@required`
 * - `@optional`
 * - `@default <value>`
 * - `@description <text>`
 * - `@pattern <regex>`
 * - `@min <number>`
 * - `@max <number>`
 *
 * @param {string[]} commentLines — Array of comment texts (leading `#` already stripped)
 * @returns {SchemaAnnotation|null} Parsed annotation or null if none found
 */
function parseAnnotations(commentLines) {
  /** @type {SchemaAnnotation} */
  const annotation = {};
  let found = false;

  for (const line of commentLines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^@(\w+)\s*(.*)?$/);
    if (!match) continue;

    const [, tag, rest = ''] = match;
    if (!SCHEMA_TAGS.has(tag)) continue;

    found = true;
    const value = rest.trim();

    switch (tag) {
      case 'required':
        annotation.required = true;
        break;
      case 'optional':
        annotation.optional = true;
        break;
      case 'min':
        annotation.min = Number(value);
        break;
      case 'max':
        annotation.max = Number(value);
        break;
      case 'type':
      case 'default':
      case 'description':
      case 'pattern':
        annotation[tag] = value;
        break;
    }
  }

  return found ? annotation : null;
}

/**
 * Split a line into key and raw-value at the first unquoted `=`.
 *
 * @param {string} line — A trimmed line of text
 * @returns {{ key: string, rawValue: string } | null} Null if not a valid assignment
 */
function splitKeyValue(line) {
  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) return null;

  const key = line.slice(0, eqIndex).trim();
  // Key must be a valid identifier (letters, digits, underscores; not starting with digit)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) return null;

  const rawValue = line.slice(eqIndex + 1);
  return { key, rawValue };
}

/**
 * Remove inline comments from an unquoted value.
 * Inline comments start with ` #` (space then hash) when the value is unquoted.
 *
 * @param {string} val — The unquoted value string
 * @returns {string} The value without inline comment
 */
function stripInlineComment(val) {
  const idx = val.indexOf(' #');
  if (idx === -1) return val;
  return val.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse a .env file into structured entries and optional schema annotations.
 *
 * Features:
 * - Standard KEY=value pairs
 * - Quoted values (single, double, backtick)
 * - Multiline quoted values
 * - Comment lines (`#`) and inline comments
 * - Variable interpolation references (`${VAR}`) preserved in values
 * - Schema annotation tags in comments (for .env.example files)
 *
 * @param {string} filePath — Absolute or relative path to the .env file
 * @returns {ParseResult} Parsed entries and schema map
 * @throws {Error} If the file cannot be read
 */
function parseEnvFile(filePath) {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, 'utf8');
  return parseEnvContent(content);
}

/**
 * Parse raw .env file content (string) into structured entries and schema.
 *
 * This is the core parsing logic, separated from file I/O for testability.
 *
 * @param {string} content — The raw file content
 * @returns {ParseResult}
 */
function parseEnvContent(content) {
  const lines = content.split(/\r?\n/);

  /** @type {EnvEntry[]} */
  const entries = [];

  /** @type {Record<string, SchemaAnnotation>} */
  const schema = {};

  /** @type {string[]} */
  let pendingComments = [];

  // Multiline state
  let inMultiline = false;
  let multilineKey = '';
  let multilineValue = '';
  let multilineLine = 0;
  let multilineRaw = '';
  let multilineQuote = '';
  let multilineComments = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();

    // --- Handle multiline continuation ----
    if (inMultiline) {
      multilineRaw += '\n' + raw;

      const closeIdx = raw.indexOf(multilineQuote);
      if (closeIdx !== -1) {
        // End of multiline value
        multilineValue += '\n' + raw.slice(0, closeIdx);
        inMultiline = false;

        let finalValue = multilineValue;
        if (multilineQuote === '"') {
          finalValue = processEscapes(finalValue);
        }

        entries.push({
          key: multilineKey,
          value: finalValue,
          line: multilineLine,
          rawLine: multilineRaw,
          comments: multilineComments,
        });

        // Schema annotations
        const ann = parseAnnotations(multilineComments);
        if (ann) schema[multilineKey] = ann;

        pendingComments = [];
      } else {
        multilineValue += '\n' + raw;
      }
      continue;
    }

    // --- Blank lines reset pending comments ---
    if (trimmed === '') {
      pendingComments = [];
      continue;
    }

    // --- Comment lines ---
    if (trimmed.startsWith('#')) {
      // Strip the leading `#` (and optional single space)
      const commentText = trimmed.slice(1).replace(/^ /, '');
      pendingComments.push(commentText);
      continue;
    }

    // --- Variable assignment ---
    const kv = splitKeyValue(trimmed);
    if (!kv) {
      // Not a valid line — skip but don't reset comments
      continue;
    }

    const { key, rawValue } = kv;
    const valueTrimmed = rawValue.trim();

    // Check for multiline
    const { isMultiline, quoteChar } = detectMultiline(valueTrimmed);
    if (isMultiline) {
      inMultiline = true;
      multilineKey = key;
      multilineValue = valueTrimmed.slice(1); // everything after opening quote
      multilineLine = lineNum;
      multilineRaw = raw;
      multilineQuote = quoteChar;
      multilineComments = [...pendingComments];
      pendingComments = [];
      continue;
    }

    // Single-line value
    let value;
    const firstChar = valueTrimmed[0];
    const isQuoted = (firstChar === '"' || firstChar === "'" || firstChar === '`');

    if (isQuoted) {
      value = stripQuotes(valueTrimmed);
      if (firstChar === '"') {
        value = processEscapes(value);
      }
    } else {
      value = stripInlineComment(valueTrimmed).trim();
    }

    const comments = [...pendingComments];
    entries.push({
      key,
      value,
      line: lineNum,
      rawLine: raw,
      comments,
    });

    // Schema annotations
    const ann = parseAnnotations(comments);
    if (ann) schema[key] = ann;

    pendingComments = [];
  }

  return { entries, schema };
}

/**
 * Extract all `${VAR}` interpolation references from a value string.
 *
 * @param {string} value — The env variable value
 * @returns {string[]} Array of referenced variable names
 */
function extractInterpolations(value) {
  const refs = [];
  const regex = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)}/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

module.exports = {
  parseEnvFile,
  parseEnvContent,
  extractInterpolations,
  stripQuotes,
  parseAnnotations,
};
