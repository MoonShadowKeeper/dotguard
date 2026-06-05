'use strict';

/**
 * @typedef {import('./validator').ValidationResult}  ValidationResult
 * @typedef {import('./validator').ValidationSummary} ValidationSummary
 */

// ---------------------------------------------------------------------------
// ANSI escape codes
// ---------------------------------------------------------------------------

const ESC = '\x1b[';

const color = {
  reset:     `${ESC}0m`,
  bold:      `${ESC}1m`,
  dim:       `${ESC}2m`,
  italic:    `${ESC}3m`,
  underline: `${ESC}4m`,

  red:       `${ESC}31m`,
  green:     `${ESC}32m`,
  yellow:    `${ESC}33m`,
  blue:      `${ESC}34m`,
  magenta:   `${ESC}35m`,
  cyan:      `${ESC}36m`,
  white:     `${ESC}37m`,

  bgRed:     `${ESC}41m`,
  bgGreen:   `${ESC}42m`,
  bgYellow:  `${ESC}43m`,
  bgCyan:    `${ESC}46m`,

  brightRed:    `${ESC}91m`,
  brightGreen:  `${ESC}92m`,
  brightYellow: `${ESC}93m`,
  brightCyan:   `${ESC}96m`,
};

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const symbols = {
  pass:    '✓',
  fail:    '✗',
  warning: '⚠',
  info:    'ℹ',
  dot:     '·',
  arrow:   '→',
  line:    '─',
  vLine:   '│',
  tl:      '┌',
  tr:      '┐',
  bl:      '└',
  br:      '┘',
  tee:     '├',
  cross:   '┼',
};

// ---------------------------------------------------------------------------
// Internal state — allows disabling color (CI mode)
// ---------------------------------------------------------------------------

let useColor = true;

/**
 * Enable or disable color output globally.
 * @param {boolean} enabled
 */
function setColorEnabled(enabled) {
  useColor = enabled;
}

/**
 * Apply an ANSI style to text if colors are enabled.
 * @param {string} style — ANSI escape sequence
 * @param {string} text
 * @returns {string}
 */
function style(style, text) {
  if (!useColor) return text;
  return `${style}${text}${color.reset}`;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

/**
 * Get the colored symbol for a severity level.
 * @param {'error'|'warning'|'info'} severity
 * @returns {string}
 */
function severitySymbol(severity) {
  switch (severity) {
    case 'error':   return style(color.brightRed,    symbols.fail);
    case 'warning': return style(color.brightYellow, symbols.warning);
    case 'info':    return style(color.brightGreen,  symbols.pass);
    default:        return style(color.dim,          symbols.dot);
  }
}

/**
 * Get the colored severity label.
 * @param {'error'|'warning'|'info'} severity
 * @returns {string}
 */
function severityLabel(severity) {
  switch (severity) {
    case 'error':   return style(color.brightRed,    'ERROR');
    case 'warning': return style(color.brightYellow, 'WARN ');
    case 'info':    return style(color.brightGreen,  'PASS ');
    default:        return style(color.dim,          'INFO ');
  }
}

// ---------------------------------------------------------------------------
// Reporters
// ---------------------------------------------------------------------------

/**
 * Print individual validation results with colored output.
 *
 * Each result is shown as:
 * ```
 *  ✗ ERROR  "KEY" should be a valid URL, got "not-a-url"    (line 5, rule: type)
 *    → Set KEY to a valid URL
 * ```
 *
 * @param {ValidationResult[]} results — Array of validation results
 * @param {Object}             [opts]
 * @param {boolean}            [opts.quiet=false] — Only show errors
 */
function reportResults(results, opts = {}) {
  const quiet = opts.quiet || false;

  // Group by severity for ordering: errors first, then warnings, then info
  const errors   = results.filter(r => r.severity === 'error');
  const warnings = results.filter(r => r.severity === 'warning');
  const infos    = results.filter(r => r.severity === 'info');

  const ordered = [...errors, ...warnings, ...(quiet ? [] : infos)];

  if (ordered.length === 0) {
    console.log(style(color.dim, '  No issues found.'));
    return;
  }

  console.log('');

  for (const result of ordered) {
    const sym   = severitySymbol(result.severity);
    const label = severityLabel(result.severity);
    const loc   = style(color.dim, `(line ${result.line}, rule: ${result.rule})`);

    console.log(`  ${sym} ${label}  ${result.message}  ${loc}`);

    if (result.suggestion) {
      console.log(`    ${style(color.cyan, symbols.arrow)} ${style(color.dim, result.suggestion)}`);
    }
  }

  console.log('');
}

/**
 * Print a beautiful summary box with pass/fail/warning counts.
 *
 * ```
 * ┌──────────────────────────────────────┐
 * │  DotGuard Validation Summary         │
 * ├──────────────────────────────────────┤
 * │  ✓  12 passed                        │
 * │  ✗   3 failed                        │
 * │  ⚠   1 warning                       │
 * └──────────────────────────────────────┘
 * ```
 *
 * @param {ValidationSummary} summary
 */
function reportSummary(summary) {
  const width = 42;
  const innerWidth = width - 2; // minus the two border chars

  /**
   * Pad a content string to fit the box width.
   * Accounts for ANSI escape sequences by computing visible length.
   * @param {string} content
   * @returns {string}
   */
  function padLine(content) {
    const visibleLen = stripAnsi(content).length;
    const padding = Math.max(0, innerWidth - visibleLen);
    return `${symbols.vLine}${content}${' '.repeat(padding)}${symbols.vLine}`;
  }

  const hLine = symbols.line.repeat(innerWidth);

  console.log('');
  console.log(`  ${style(color.dim, `${symbols.tl}${hLine}${symbols.tr}`)}`);

  // Title
  const title = `  ${style(color.bold, 'DotGuard Validation Summary')}`;
  console.log(`  ${style(color.dim, symbols.vLine)}${title}${' '.repeat(Math.max(0, innerWidth - stripAnsi(title).length))}${style(color.dim, symbols.vLine)}`);

  console.log(`  ${style(color.dim, `${symbols.tee}${hLine}${symbols.br.replace(symbols.br, '┤')}`)}`);

  // Stats
  const passedLine  = `  ${style(color.brightGreen,  symbols.pass)}  ${style(color.brightGreen,  `${summary.passed} passed`)}`;
  const failedLine  = `  ${style(color.brightRed,    symbols.fail)}  ${style(color.brightRed,    `${summary.failed} failed`)}`;
  const warningLine = `  ${style(color.brightYellow, symbols.warning)}  ${style(color.brightYellow, `${summary.warnings} warning${summary.warnings !== 1 ? 's' : ''}`)}`;

  console.log(`  ${style(color.dim, symbols.vLine)}${passedLine}${' '.repeat(Math.max(0, innerWidth - stripAnsi(passedLine).length))}${style(color.dim, symbols.vLine)}`);
  console.log(`  ${style(color.dim, symbols.vLine)}${failedLine}${' '.repeat(Math.max(0, innerWidth - stripAnsi(failedLine).length))}${style(color.dim, symbols.vLine)}`);
  console.log(`  ${style(color.dim, symbols.vLine)}${warningLine}${' '.repeat(Math.max(0, innerWidth - stripAnsi(warningLine).length))}${style(color.dim, symbols.vLine)}`);

  console.log(`  ${style(color.dim, `${symbols.bl}${hLine}${symbols.br}`)}`);

  // Final verdict
  console.log('');
  if (summary.failed > 0) {
    console.log(`  ${style(`${color.bold}${color.brightRed}`, 'Validation failed.')}  Fix the errors above and try again.`);
  } else if (summary.warnings > 0) {
    console.log(`  ${style(`${color.bold}${color.brightYellow}`, 'Validation passed with warnings.')}  Consider fixing the warnings above.`);
  } else {
    console.log(`  ${style(`${color.bold}${color.brightGreen}`, 'Validation passed!')}  All checks passed successfully.`);
  }
  console.log('');
}

/**
 * Print a table of all environment variables and their validation status.
 *
 * ```
 *  Variable        │ Value          │ Status
 *  ────────────────┼────────────────┼────────
 *  DATABASE_URL    │ postgres://... │ ✓ pass
 *  API_KEY         │ (empty)        │ ✗ fail
 * ```
 *
 * @param {Array<{ key: string, value: string, status: 'pass'|'fail'|'warning' }>} entries
 */
function reportTable(entries) {
  if (entries.length === 0) {
    console.log(style(color.dim, '  No entries to display.'));
    return;
  }

  // Compute column widths
  const keyWidth   = Math.max(8,  ...entries.map(e => e.key.length));
  const valWidth   = Math.max(8,  ...entries.map(e => displayValue(e.value).length));
  const statusWidth = 10;

  // Clamp to reasonable widths
  const maxKeyW   = Math.min(keyWidth, 30);
  const maxValW   = Math.min(valWidth, 40);

  // Header
  const header = `  ${pad('Variable', maxKeyW)}  ${style(color.dim, symbols.vLine)}  ${pad('Value', maxValW)}  ${style(color.dim, symbols.vLine)}  ${pad('Status', statusWidth)}`;
  console.log('');
  console.log(header);

  const divider = `  ${symbols.line.repeat(maxKeyW)}${symbols.line.repeat(2)}${symbols.cross}${symbols.line.repeat(maxValW + 2)}${symbols.line.repeat(2)}${symbols.cross}${symbols.line.repeat(statusWidth + 2)}`;
  console.log(style(color.dim, divider));

  // Rows
  for (const entry of entries) {
    const key   = pad(truncate(entry.key, maxKeyW), maxKeyW);
    const val   = pad(truncate(displayValue(entry.value), maxValW), maxValW);
    const stSym = entry.status === 'pass'
      ? style(color.brightGreen, `${symbols.pass} pass`)
      : entry.status === 'warning'
        ? style(color.brightYellow, `${symbols.warning} warn`)
        : style(color.brightRed, `${symbols.fail} fail`);

    console.log(`  ${key}  ${style(color.dim, symbols.vLine)}  ${val}  ${style(color.dim, symbols.vLine)}  ${stSym}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Strip ANSI escape codes from a string to get visible length.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Pad a string to a minimum width.
 * @param {string} str
 * @param {number} width
 * @returns {string}
 */
function pad(str, width) {
  const visible = stripAnsi(str);
  if (visible.length >= width) return str;
  return str + ' '.repeat(width - visible.length);
}

/**
 * Truncate a string to a max width, adding ellipsis if needed.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

/**
 * Format a value for display, replacing empty strings and multiline values.
 * @param {string} value
 * @returns {string}
 */
function displayValue(value) {
  if (value === '' || value === undefined) return '(empty)';
  // Replace newlines for table display
  const oneLined = value.replace(/\n/g, '\\n');
  return oneLined;
}

module.exports = {
  reportResults,
  reportSummary,
  reportTable,
  setColorEnabled,
  stripAnsi,
};
