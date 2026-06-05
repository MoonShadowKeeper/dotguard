#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('../src/parser');
const { validateSync } = require('../src/validator');
const { reportResults, reportSummary, reportTable, setColorEnabled } = require('../src/reporter');

// ---------------------------------------------------------------------------
// ANSI helpers (duplicated here to avoid importing reporter internals)
// ---------------------------------------------------------------------------

const ESC = '\x1b[';
const c = {
  reset:     `${ESC}0m`,
  bold:      `${ESC}1m`,
  dim:       `${ESC}2m`,
  red:       `${ESC}31m`,
  green:     `${ESC}32m`,
  yellow:    `${ESC}33m`,
  cyan:      `${ESC}36m`,
  brightGreen:  `${ESC}92m`,
  brightCyan:   `${ESC}96m`,
};

let colorEnabled = true;

/**
 * Apply color if enabled.
 * @param {string} ansi
 * @param {string} text
 * @returns {string}
 */
function clr(ansi, text) {
  return colorEnabled ? `${ansi}${text}${c.reset}` : text;
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = pkg.version;

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CliArgs
 * @property {string}  command   — The subcommand (validate, init, diff, sync)
 * @property {string}  envPath   — Path to the .env file
 * @property {string}  schemaPath — Path to the schema / .env.example file
 * @property {boolean} strict    — Treat warnings as errors
 * @property {boolean} ci        — CI mode (no colors, exit 1 on fail)
 * @property {'text'|'json'} format — Output format
 * @property {boolean} quiet     — Only show errors
 * @property {boolean} help      — Show help
 * @property {boolean} version   — Show version
 */

/**
 * Parse process.argv into structured CLI arguments.
 *
 * @param {string[]} argv — Raw argv (process.argv.slice(2))
 * @returns {CliArgs}
 */
function parseArgs(argv) {
  /** @type {CliArgs} */
  const args = {
    command:    'validate',
    envPath:    '.env',
    schemaPath: '.env.example',
    strict:     false,
    ci:         false,
    format:     'text',
    quiet:      false,
    help:       false,
    version:    false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--version':
      case '-v':
        args.version = true;
        break;
      case '--strict':
        args.strict = true;
        break;
      case '--ci':
        args.ci = true;
        break;
      case '--quiet':
      case '-q':
        args.quiet = true;
        break;
      case '--env':
        args.envPath = argv[++i] || '.env';
        break;
      case '--schema':
        args.schemaPath = argv[++i] || '.env.example';
        break;
      case '--format':
        args.format = /** @type {'text'|'json'} */ (argv[++i] || 'text');
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(clr(c.red, `Unknown option: ${arg}`));
          console.error(`Run ${clr(c.cyan, 'dotguard --help')} for usage.`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }

  if (positional.length > 0) {
    args.command = positional[0];
  }

  return args;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

/**
 * Print the help message and exit.
 */
function showHelp() {
  const title = clr(`${c.bold}${c.brightCyan}`, 'dotguard');
  const ver   = clr(c.dim, `v${VERSION}`);

  console.log(`
  ${title} ${ver}
  ${clr(c.dim, 'Universal .env file validator — validate, lint, and enforce env schemas')}

  ${clr(c.bold, 'USAGE')}

    ${clr(c.cyan, 'dotguard')} ${clr(c.dim, '[command] [options]')}

  ${clr(c.bold, 'COMMANDS')}

    ${clr(c.brightGreen, 'validate')}   Validate .env against .env.example ${clr(c.dim, '(default)')}
    ${clr(c.brightGreen, 'init')}       Create .env.example from existing .env with schema annotations
    ${clr(c.brightGreen, 'diff')}       Show differences between .env and .env.example
    ${clr(c.brightGreen, 'sync')}       Add missing keys from .env.example to .env

  ${clr(c.bold, 'OPTIONS')}

    ${clr(c.cyan, '--env <path>')}      Path to .env file          ${clr(c.dim, '(default: .env)')}
    ${clr(c.cyan, '--schema <path>')}   Path to schema file        ${clr(c.dim, '(default: .env.example)')}
    ${clr(c.cyan, '--strict')}          Treat warnings as errors
    ${clr(c.cyan, '--ci')}              CI mode (no colors, exit 1 on failure)
    ${clr(c.cyan, '--format <fmt>')}    Output format: text, json  ${clr(c.dim, '(default: text)')}
    ${clr(c.cyan, '--quiet, -q')}       Only show errors
    ${clr(c.cyan, '--help, -h')}        Show this help message
    ${clr(c.cyan, '--version, -v')}     Show version

  ${clr(c.bold, 'EXAMPLES')}

    ${clr(c.dim, '# Validate with defaults')}
    $ dotguard validate

    ${clr(c.dim, '# Use custom paths')}
    $ dotguard validate --env .env.production --schema .env.schema

    ${clr(c.dim, '# CI mode with strict checking')}
    $ dotguard validate --strict --ci

    ${clr(c.dim, '# Generate schema from existing .env')}
    $ dotguard init

    ${clr(c.dim, '# JSON output for scripting')}
    $ dotguard validate --format json
`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Run the `validate` command.
 *
 * @param {CliArgs} args
 */
function cmdValidate(args) {
  const envPath    = path.resolve(args.envPath);
  const schemaPath = path.resolve(args.schemaPath);

  if (!fs.existsSync(envPath)) {
    console.error(clr(c.red, `  ✗ .env file not found: ${envPath}`));
    process.exit(1);
  }
  if (!fs.existsSync(schemaPath)) {
    console.error(clr(c.red, `  ✗ Schema file not found: ${schemaPath}`));
    console.error(clr(c.dim, `    Run ${clr(c.cyan, 'dotguard init')} to generate one from your .env file.`));
    process.exit(1);
  }

  const summary = validateSync(envPath, schemaPath, {
    strict: args.strict,
  });

  if (args.format === 'json') {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    // Header
    console.log('');
    console.log(`  ${clr(`${c.bold}${c.brightCyan}`, 'DotGuard')} ${clr(c.dim, '— validating environment')}`);
    console.log(`  ${clr(c.dim, 'env:')}    ${envPath}`);
    console.log(`  ${clr(c.dim, 'schema:')} ${schemaPath}`);

    reportResults(summary.results, { quiet: args.quiet });
    reportSummary(summary);

    // Build table entries
    const envParsed = parseEnvFile(envPath);
    const errorKeys = new Set(
      summary.results.filter(r => r.severity === 'error').map(r => r.key),
    );
    const warnKeys = new Set(
      summary.results.filter(r => r.severity === 'warning').map(r => r.key),
    );

    const tableEntries = envParsed.entries.map(e => ({
      key:    e.key,
      value:  e.value,
      status: errorKeys.has(e.key) ? 'fail' : warnKeys.has(e.key) ? 'warning' : 'pass',
    }));

    if (!args.quiet && tableEntries.length > 0) {
      reportTable(tableEntries);
    }
  }

  if (summary.failed > 0) {
    process.exit(1);
  }
}

/**
 * Run the `init` command — generate .env.example from existing .env.
 *
 * @param {CliArgs} args
 */
function cmdInit(args) {
  const envPath    = path.resolve(args.envPath);
  const schemaPath = path.resolve(args.schemaPath);

  if (!fs.existsSync(envPath)) {
    console.error(clr(c.red, `  ✗ .env file not found: ${envPath}`));
    process.exit(1);
  }

  if (fs.existsSync(schemaPath)) {
    console.error(clr(c.yellow, `  ⚠ Schema file already exists: ${schemaPath}`));
    console.error(clr(c.dim, '    Delete it first or use a different path with --schema'));
    process.exit(1);
  }

  const parsed = parseEnvFile(envPath);
  const lines = [];

  lines.push('# Environment Variable Schema');
  lines.push(`# Generated by dotguard v${VERSION} on ${new Date().toISOString().slice(0, 10)}`);
  lines.push('# Add @type, @required, @optional, @default, @description, @pattern, @min, @max annotations');
  lines.push('');

  for (const entry of parsed.entries) {
    // Try to infer the type
    const inferredType = inferType(entry.value);

    lines.push(`# @type ${inferredType}`);
    lines.push(`# @required`);
    lines.push(`# @description TODO: describe ${entry.key}`);
    lines.push(`${entry.key}=`);
    lines.push('');
  }

  fs.writeFileSync(schemaPath, lines.join('\n'), 'utf8');

  console.log('');
  console.log(`  ${clr(c.brightGreen, '✓')} Schema file created: ${clr(c.cyan, schemaPath)}`);
  console.log(`  ${clr(c.dim, `  ${parsed.entries.length} variable(s) documented with inferred types.`)}`);
  console.log(`  ${clr(c.dim, '  Edit the file to refine types, add descriptions, and mark optional vars.')}`);
  console.log('');
}

/**
 * Run the `diff` command — show differences between .env and .env.example.
 *
 * @param {CliArgs} args
 */
function cmdDiff(args) {
  const envPath    = path.resolve(args.envPath);
  const schemaPath = path.resolve(args.schemaPath);

  if (!fs.existsSync(envPath)) {
    console.error(clr(c.red, `  ✗ .env file not found: ${envPath}`));
    process.exit(1);
  }
  if (!fs.existsSync(schemaPath)) {
    console.error(clr(c.red, `  ✗ Schema file not found: ${schemaPath}`));
    process.exit(1);
  }

  const env    = parseEnvFile(envPath);
  const schema = parseEnvFile(schemaPath);

  const envKeys    = new Set(env.entries.map(e => e.key));
  const schemaKeys = new Set(schema.entries.map(e => e.key));

  const missing   = [...schemaKeys].filter(k => !envKeys.has(k));
  const extra     = [...envKeys].filter(k => !schemaKeys.has(k));
  const common    = [...envKeys].filter(k => schemaKeys.has(k));

  console.log('');
  console.log(`  ${clr(`${c.bold}${c.brightCyan}`, 'DotGuard Diff')}`);
  console.log(`  ${clr(c.dim, 'env:')}    ${envPath}`);
  console.log(`  ${clr(c.dim, 'schema:')} ${schemaPath}`);
  console.log('');

  if (missing.length > 0) {
    console.log(`  ${clr(c.brightGreen, '+ Missing from .env')} ${clr(c.dim, `(${missing.length} key${missing.length !== 1 ? 's' : ''})`)}`);
    for (const key of missing) {
      console.log(`    ${clr(c.green, '+')} ${key}`);
    }
    console.log('');
  }

  if (extra.length > 0) {
    console.log(`  ${clr(c.brightRed, '- Extra in .env')} ${clr(c.dim, `(${extra.length} key${extra.length !== 1 ? 's' : ''})`)}`);
    for (const key of extra) {
      console.log(`    ${clr(c.red, '-')} ${key}`);
    }
    console.log('');
  }

  if (common.length > 0) {
    console.log(`  ${clr(c.dim, `  ${common.length} key${common.length !== 1 ? 's' : ''} in common`)}`);
    console.log('');
  }

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ${clr(c.brightGreen, '✓')} Files are in sync — no differences found.`);
    console.log('');
  }
}

/**
 * Run the `sync` command — add missing keys from .env.example to .env.
 *
 * @param {CliArgs} args
 */
function cmdSync(args) {
  const envPath    = path.resolve(args.envPath);
  const schemaPath = path.resolve(args.schemaPath);

  if (!fs.existsSync(schemaPath)) {
    console.error(clr(c.red, `  ✗ Schema file not found: ${schemaPath}`));
    process.exit(1);
  }

  // Create .env if it doesn't exist
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, '', 'utf8');
  }

  const env    = parseEnvFile(envPath);
  const schema = parseEnvFile(schemaPath);

  const envKeys    = new Set(env.entries.map(e => e.key));
  const missing    = schema.entries.filter(e => !envKeys.has(e.key));

  if (missing.length === 0) {
    console.log('');
    console.log(`  ${clr(c.brightGreen, '✓')} All keys are already present in .env`);
    console.log('');
    return;
  }

  // Append missing keys
  let content = fs.readFileSync(envPath, 'utf8');
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }

  content += `\n# Added by dotguard sync on ${new Date().toISOString().slice(0, 10)}\n`;

  for (const entry of missing) {
    const defaultValue = (schema.schema[entry.key] && schema.schema[entry.key].default) || '';
    content += `${entry.key}=${defaultValue}\n`;
  }

  fs.writeFileSync(envPath, content, 'utf8');

  console.log('');
  console.log(`  ${clr(c.brightGreen, '✓')} Synced ${clr(c.bold, String(missing.length))} missing key${missing.length !== 1 ? 's' : ''} to ${clr(c.cyan, envPath)}`);
  console.log('');

  for (const entry of missing) {
    console.log(`    ${clr(c.green, '+')} ${entry.key}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Type inference (for init command)
// ---------------------------------------------------------------------------

/**
 * Infer the env variable type from its value.
 *
 * @param {string} value
 * @returns {string}
 */
function inferType(value) {
  if (value === '') return 'string';
  if (/^(true|false)$/i.test(value)) return 'boolean';
  if (/^(yes|no|on|off)$/i.test(value)) return 'boolean';
  if (/^[0-9]+$/.test(value)) {
    const n = Number(value);
    if (n >= 1 && n <= 65535) return 'port';
    return 'number';
  }
  if (/^[0-9]*\.[0-9]+$/.test(value)) return 'number';
  if (/^https?:\/\//i.test(value)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  return 'string';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));

  // CI mode: disable colors
  if (args.ci || process.env.NO_COLOR || process.env.CI) {
    colorEnabled = false;
    setColorEnabled(false);
  }

  if (args.version) {
    console.log(`dotguard v${VERSION}`);
    process.exit(0);
  }

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  switch (args.command) {
    case 'validate':
      cmdValidate(args);
      break;
    case 'init':
      cmdInit(args);
      break;
    case 'diff':
      cmdDiff(args);
      break;
    case 'sync':
      cmdSync(args);
      break;
    default:
      console.error(clr(c.red, `  ✗ Unknown command: ${args.command}`));
      console.error(`  Run ${clr(c.cyan, 'dotguard --help')} for usage.`);
      process.exit(1);
  }
}

main();
