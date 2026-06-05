#!/usr/bin/env node

/**
 * dotguard test suite
 *
 * Uses only the built-in Node.js `assert` module.
 * Run with: node test/run.js
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Paths – resolve relative to the project root (one level up from test/)
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const PARSER_PATH = path.join(ROOT, 'src', 'parser.js');
const VALIDATOR_PATH = path.join(ROOT, 'src', 'validator.js');

// ---------------------------------------------------------------------------
// Lazy loaders – the modules may not exist yet during early development, so
// we guard the require calls and skip tests gracefully when files are absent.
// ---------------------------------------------------------------------------

/** @type {import('../src/parser.js') | null} */
let parser = null;
/** @type {import('../src/validator.js') | null} */
let validator = null;

try { parser = require(PARSER_PATH); } catch { /* module not available */ }
try { validator = require(VALIDATOR_PATH); } catch { /* module not available */ }

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

/** @type {{ name: string, fn: () => void | Promise<void>, skip?: boolean }[]} */
const tests = [];
let passed = 0;
let failed = 0;
let skipped = 0;

/**
 * Register a test case.
 * @param {string} name  - Human-readable description.
 * @param {() => void | Promise<void>} fn - Test body.
 * @param {{ skip?: boolean }} [opts]
 */
function test(name, fn, opts = {}) {
  tests.push({ name, fn, skip: opts.skip ?? false });
}

/**
 * Register a test that requires the parser module.
 * @param {string} name
 * @param {(mod: NonNullable<typeof parser>) => void | Promise<void>} fn
 */
function testParser(name, fn) {
  test(name, () => fn(/** @type {NonNullable<typeof parser>} */ (parser)), {
    skip: parser === null,
  });
}

/**
 * Register a test that requires the validator module.
 * @param {string} name
 * @param {(mod: NonNullable<typeof validator>) => void | Promise<void>} fn
 */
function testValidator(name, fn) {
  test(name, () => fn(/** @type {NonNullable<typeof validator>} */ (validator)), {
    skip: validator === null,
  });
}

// ===========================================================================
//  PARSER TESTS
// ===========================================================================

testParser('Parser: parses simple KEY=VALUE pairs', (mod) => {
  const input = 'FOO=bar\nBAZ=qux\n';
  const result = mod.parseEnv(input);
  assert.equal(result.FOO, 'bar');
  assert.equal(result.BAZ, 'qux');
});

testParser('Parser: handles empty values', (mod) => {
  const input = 'EMPTY=\nALSO_EMPTY=';
  const result = mod.parseEnv(input);
  assert.equal(result.EMPTY, '');
  assert.equal(result.ALSO_EMPTY, '');
});

testParser('Parser: ignores comment-only and blank lines', (mod) => {
  const input = '# This is a comment\n\nFOO=bar\n# Another comment\nBAZ=qux';
  const result = mod.parseEnv(input);
  assert.equal(Object.keys(result).length, 2);
  assert.equal(result.FOO, 'bar');
  assert.equal(result.BAZ, 'qux');
});

testParser('Parser: handles values with equals signs', (mod) => {
  const input = 'CONNECTION=postgres://u:p@host/db?opt=1&x=2';
  const result = mod.parseEnv(input);
  assert.equal(result.CONNECTION, 'postgres://u:p@host/db?opt=1&x=2');
});

testParser('Parser: handles quoted values (double quotes)', (mod) => {
  const input = 'GREETING="hello world"\nPATH_VAR="C:\\\\Users"';
  const result = mod.parseEnv(input);
  assert.equal(result.GREETING, 'hello world');
});

testParser('Parser: handles quoted values (single quotes)', (mod) => {
  const input = "RAW='no $expansion here'";
  const result = mod.parseEnv(input);
  assert.equal(result.RAW, 'no $expansion here');
});

testParser('Parser: parses schema annotations from comments', (mod) => {
  const input = [
    '# @type url',
    '# @required',
    '# @description Database connection string',
    'DATABASE_URL=postgres://localhost/mydb',
  ].join('\n');
  const schema = mod.parseSchema(input);
  const entry = schema.find((e) => e.name === 'DATABASE_URL');
  assert.ok(entry, 'DATABASE_URL should be in schema');
  assert.equal(entry.type, 'url');
  assert.equal(entry.required, true);
  assert.equal(entry.description, 'Database connection string');
});

testParser('Parser: parses enum type with values', (mod) => {
  const input = [
    '# @type enum(debug,info,warn,error)',
    '# @required',
    'LOG_LEVEL=info',
  ].join('\n');
  const schema = mod.parseSchema(input);
  const entry = schema.find((e) => e.name === 'LOG_LEVEL');
  assert.ok(entry);
  assert.equal(entry.type, 'enum');
  assert.deepEqual(entry.enumValues, ['debug', 'info', 'warn', 'error']);
});

testParser('Parser: parses @min and @max annotations', (mod) => {
  const input = [
    '# @type string',
    '# @min 8',
    '# @max 128',
    'PASSWORD=secret123',
  ].join('\n');
  const schema = mod.parseSchema(input);
  const entry = schema.find((e) => e.name === 'PASSWORD');
  assert.ok(entry);
  assert.equal(entry.min, 8);
  assert.equal(entry.max, 128);
});

testParser('Parser: parses @pattern annotation', (mod) => {
  const input = [
    '# @type string',
    '# @pattern ^v\\d+\\.\\d+\\.\\d+$',
    'VERSION=v1.0.0',
  ].join('\n');
  const schema = mod.parseSchema(input);
  const entry = schema.find((e) => e.name === 'VERSION');
  assert.ok(entry);
  assert.equal(entry.pattern, '^v\\d+\\.\\d+\\.\\d+$');
});

testParser('Parser: parses @default annotation', (mod) => {
  const input = [
    '# @type port',
    '# @optional',
    '# @default 3000',
    'PORT=3000',
  ].join('\n');
  const schema = mod.parseSchema(input);
  const entry = schema.find((e) => e.name === 'PORT');
  assert.ok(entry);
  assert.equal(entry.defaultValue, '3000');
  assert.equal(entry.required, false);
});

// ===========================================================================
//  VALIDATOR TESTS
// ===========================================================================

testValidator('Validator: url type accepts valid URLs', (mod) => {
  assert.equal(mod.validateType('url', 'https://example.com'), true);
  assert.equal(mod.validateType('url', 'redis://localhost:6379'), true);
  assert.equal(mod.validateType('url', 'postgres://user:pass@host/db'), true);
});

testValidator('Validator: url type rejects invalid URLs', (mod) => {
  assert.equal(mod.validateType('url', 'not-a-url'), false);
  assert.equal(mod.validateType('url', ''), false);
});

testValidator('Validator: port type validates range 1-65535', (mod) => {
  assert.equal(mod.validateType('port', '80'), true);
  assert.equal(mod.validateType('port', '3000'), true);
  assert.equal(mod.validateType('port', '65535'), true);
  assert.equal(mod.validateType('port', '0'), false);
  assert.equal(mod.validateType('port', '65536'), false);
  assert.equal(mod.validateType('port', 'abc'), false);
});

testValidator('Validator: email type validates addresses', (mod) => {
  assert.equal(mod.validateType('email', 'user@example.com'), true);
  assert.equal(mod.validateType('email', 'a+b@sub.domain.co'), true);
  assert.equal(mod.validateType('email', 'not-an-email'), false);
  assert.equal(mod.validateType('email', '@missing.local'), false);
});

testValidator('Validator: boolean type accepts common values', (mod) => {
  for (const v of ['true', 'false', '1', '0', 'yes', 'no']) {
    assert.equal(mod.validateType('boolean', v), true, `"${v}" should be valid boolean`);
  }
  assert.equal(mod.validateType('boolean', 'maybe'), false);
});

testValidator('Validator: number type validates numeric strings', (mod) => {
  assert.equal(mod.validateType('number', '42'), true);
  assert.equal(mod.validateType('number', '3.14'), true);
  assert.equal(mod.validateType('number', '-10'), true);
  assert.equal(mod.validateType('number', 'abc'), false);
});

testValidator('Validator: integer type rejects floats', (mod) => {
  assert.equal(mod.validateType('integer', '42'), true);
  assert.equal(mod.validateType('integer', '-7'), true);
  assert.equal(mod.validateType('integer', '3.14'), false);
});

testValidator('Validator: enum validation', (mod) => {
  const allowed = ['a', 'b', 'c'];
  assert.equal(mod.validateEnum('b', allowed), true);
  assert.equal(mod.validateEnum('d', allowed), false);
});

testValidator('Validator: pattern matching', (mod) => {
  assert.equal(mod.validatePattern('v1.2.3', '^v\\d+\\.\\d+\\.\\d+$'), true);
  assert.equal(mod.validatePattern('1.2.3', '^v\\d+\\.\\d+\\.\\d+$'), false);
});

testValidator('Validator: min length check', (mod) => {
  assert.equal(mod.validateMin('abcdef', 5), true);   // 6 >= 5
  assert.equal(mod.validateMin('abc', 5), false);      // 3 < 5
  assert.equal(mod.validateMin('exact', 5), true);     // 5 >= 5
});

testValidator('Validator: max length check', (mod) => {
  assert.equal(mod.validateMax('abc', 5), true);       // 3 <= 5
  assert.equal(mod.validateMax('abcdef', 5), false);   // 6 > 5
});

// ===========================================================================
//  INTEGRATION / PIPELINE TESTS
// ===========================================================================

testParser('Integration: schema file in project root is parseable', (mod) => {
  const fs = require('node:fs');
  const examplePath = path.join(ROOT, '.env.example');
  if (!fs.existsSync(examplePath)) {
    // Not a failure — file might not exist in CI
    return;
  }
  const content = fs.readFileSync(examplePath, 'utf-8');
  const schema = mod.parseSchema(content);
  assert.ok(Array.isArray(schema), 'parseSchema should return an array');
  assert.ok(schema.length > 0, '.env.example should define at least one variable');

  // Spot-check a known entry
  const port = schema.find((e) => e.name === 'PORT');
  assert.ok(port, 'PORT should be in schema');
  assert.equal(port.type, 'port');
  assert.equal(port.required, true);
});

test('Integration: .env file is parseable', () => {
  const fs = require('node:fs');
  if (!parser) return; // skip if parser not available

  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  const env = parser.parseEnv(content);
  assert.ok(typeof env === 'object', 'parseEnv should return an object');
  assert.ok('APP_NAME' in env, '.env should contain APP_NAME');
}, { skip: parser === null });

// ===========================================================================
//  RUN
// ===========================================================================

async function run() {
  console.log();
  console.log('  🛡️  dotguard — test suite');
  console.log('  ════════════════════════════════════════');
  console.log();

  for (const t of tests) {
    if (t.skip) {
      skipped++;
      console.log(`  ⏭  ${t.name} (skipped — module not available)`);
      continue;
    }

    try {
      await t.fn();
      passed++;
      console.log(`  ✔  ${t.name}`);
    } catch (/** @type {any} */ err) {
      failed++;
      console.log(`  ✖  ${t.name}`);
      console.log(`     ${err.message}`);
    }
  }

  console.log();
  console.log('  ────────────────────────────────────────');
  console.log(`  Results: ${passed} passed · ${failed} failed · ${skipped} skipped`);
  console.log('  ════════════════════════════════════════');
  console.log();

  if (failed > 0) {
    process.exit(1);
  }
}

run();
