#!/usr/bin/env node

/**
 * dotguard integration test suite
 * Runs the CLI against a mock valid and invalid .env file.
 */

'use strict';

const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT, 'bin', 'dotguard.js');

// Setup mock files
const mockSchemaPath = path.join(__dirname, '.env.mock.example');
const mockValidPath = path.join(__dirname, '.env.mock.valid');
const mockInvalidPath = path.join(__dirname, '.env.mock.invalid');

fs.writeFileSync(mockSchemaPath, `
# @type string
# @required
APP_NAME=

# @type port
PORT=

# @type boolean
DEBUG=
`);

fs.writeFileSync(mockValidPath, `
APP_NAME=MyApp
PORT=3000
DEBUG=true
`);

fs.writeFileSync(mockInvalidPath, `
APP_NAME=
PORT=999999
DEBUG=yes
`);

console.log('dotguard — integration tests\n');

try {
  // Test 1: Valid environment
  console.log('Running test: Valid environment');
  execSync(`node "${CLI_PATH}" validate --env "${mockValidPath}" --schema "${mockSchemaPath}" --ci`, { stdio: 'pipe' });
  console.log('  Passed\n');

  // Test 2: Invalid environment
  console.log('Running test: Invalid environment');
  try {
    execSync(`node "${CLI_PATH}" validate --env "${mockInvalidPath}" --schema "${mockSchemaPath}" --ci`, { stdio: 'pipe' });
    assert.fail('Should have exited with non-zero status code');
  } catch (error) {
    const output = error.stdout.toString() + error.stderr.toString();
    assert.match(output, /Validation failed/);
    assert.match(output, /should be a valid port number/); // from port rule
    console.log('  Passed\n');
  }

  console.log('All tests passed!');
} finally {
  // Cleanup
  try { fs.unlinkSync(mockSchemaPath); } catch {}
  try { fs.unlinkSync(mockValidPath); } catch {}
  try { fs.unlinkSync(mockInvalidPath); } catch {}
}
