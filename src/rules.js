'use strict';

const { extractInterpolations } = require('./parser');

/**
 * @typedef {import('./parser').EnvEntry}        EnvEntry
 * @typedef {import('./parser').SchemaAnnotation} SchemaAnnotation
 */

/**
 * @typedef {Object} RuleResult
 * @property {boolean}                     valid      — Whether the check passed
 * @property {string}                      message    — Human-readable message
 * @property {'error'|'warning'|'info'}    severity   — Severity level
 * @property {string}                      [suggestion] — Optional fix suggestion
 */

/**
 * @callback RuleFunction
 * @param {EnvEntry}                             entry      — The entry being validated
 * @param {SchemaAnnotation|undefined}           schema     — Schema annotation for this key (if any)
 * @param {EnvEntry[]}                           allEntries — All parsed entries
 * @param {Record<string, SchemaAnnotation>}     allSchema  — Full schema map
 * @returns {RuleResult|null} Result or null to skip
 */

// ---------------------------------------------------------------------------
// Type validators
// ---------------------------------------------------------------------------

/**
 * Check if a string represents a valid number.
 * @param {string} val
 * @returns {boolean}
 */
function isNumber(val) {
  if (val === '') return false;
  return !Number.isNaN(Number(val));
}

/**
 * Check if a string represents a boolean.
 * @param {string} val
 * @returns {boolean}
 */
function isBoolean(val) {
  return ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(val.toLowerCase());
}

/**
 * Check if a string looks like a URL.
 * @param {string} val
 * @returns {boolean}
 */
function isUrl(val) {
  try {
    const u = new URL(val);
    return ['http:', 'https:', 'ftp:', 'ftps:'].includes(u.protocol);
  } catch {
    return false;
  }
}

/**
 * Check if a string looks like an email address.
 * @param {string} val
 * @returns {boolean}
 */
function isEmail(val) {
  // Simple but reasonable email pattern
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
}

/**
 * Check if a string represents a valid port number (1–65535).
 * @param {string} val
 * @returns {boolean}
 */
function isPort(val) {
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

/**
 * Validate a value against a type specifier string.
 *
 * Supported types: string, number, boolean, url, email, port, enum(val1,val2,…)
 *
 * @param {string} value — The value to check
 * @param {string} type  — The type specifier
 * @returns {{ valid: boolean, expected: string }}
 */
function validateType(value, type) {
  // enum(val1,val2,…)
  const enumMatch = type.match(/^enum\((.+)\)$/i);
  if (enumMatch) {
    const allowed = enumMatch[1].split(',').map(v => v.trim());
    return {
      valid: allowed.includes(value),
      expected: `one of: ${allowed.join(', ')}`,
    };
  }

  switch (type.toLowerCase()) {
    case 'string':
      return { valid: true, expected: 'string' };
    case 'number':
      return { valid: isNumber(value), expected: 'a numeric value' };
    case 'boolean':
      return { valid: isBoolean(value), expected: 'a boolean (true/false/1/0/yes/no)' };
    case 'url':
      return { valid: isUrl(value), expected: 'a valid URL' };
    case 'email':
      return { valid: isEmail(value), expected: 'a valid email address' };
    case 'port':
      return { valid: isPort(value), expected: 'a valid port number (1–65535)' };
    default:
      return { valid: true, expected: type };
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Rule: required — key must exist and have a non-empty value.
 * @type {RuleFunction}
 */
function required(entry, schema) {
  if (!schema || !schema.required) return null;

  if (entry.value === '' || entry.value === undefined) {
    return {
      valid: false,
      message: `"${entry.key}" is required but has no value`,
      severity: 'error',
      suggestion: `Set a value for ${entry.key}`,
    };
  }
  return {
    valid: true,
    message: `"${entry.key}" is present and non-empty`,
    severity: 'info',
  };
}

/**
 * Rule: type — value must match the declared type.
 * @type {RuleFunction}
 */
function type(entry, schema) {
  if (!schema || !schema.type) return null;
  // Skip type check for empty optional values
  if (entry.value === '' && schema.optional) return null;
  if (entry.value === '') return null;

  const result = validateType(entry.value, schema.type);
  if (!result.valid) {
    return {
      valid: false,
      message: `"${entry.key}" should be ${result.expected}, got "${entry.value}"`,
      severity: 'error',
      suggestion: `Change the value of ${entry.key} to ${result.expected}`,
    };
  }
  return {
    valid: true,
    message: `"${entry.key}" matches type "${schema.type}"`,
    severity: 'info',
  };
}

/**
 * Rule: pattern — value must match a regex pattern.
 * @type {RuleFunction}
 */
function pattern(entry, schema) {
  if (!schema || !schema.pattern) return null;
  if (entry.value === '' && schema.optional) return null;
  if (entry.value === '') return null;

  let regex;
  try {
    regex = new RegExp(schema.pattern);
  } catch {
    return {
      valid: false,
      message: `Invalid regex pattern "${schema.pattern}" for "${entry.key}"`,
      severity: 'error',
    };
  }

  if (!regex.test(entry.value)) {
    return {
      valid: false,
      message: `"${entry.key}" does not match pattern /${schema.pattern}/`,
      severity: 'error',
      suggestion: `Update "${entry.key}" to match the pattern /${schema.pattern}/`,
    };
  }

  return {
    valid: true,
    message: `"${entry.key}" matches pattern /${schema.pattern}/`,
    severity: 'info',
  };
}

/**
 * Rule: range — numeric value within min/max bounds.
 * @type {RuleFunction}
 */
function range(entry, schema) {
  if (!schema) return null;
  if (schema.min === undefined && schema.max === undefined) return null;
  if (entry.value === '') return null;

  const num = Number(entry.value);
  if (Number.isNaN(num)) {
    return {
      valid: false,
      message: `"${entry.key}" must be a number to apply range check, got "${entry.value}"`,
      severity: 'error',
    };
  }

  if (schema.min !== undefined && num < schema.min) {
    return {
      valid: false,
      message: `"${entry.key}" value ${num} is below minimum ${schema.min}`,
      severity: 'error',
      suggestion: `Set "${entry.key}" to at least ${schema.min}`,
    };
  }

  if (schema.max !== undefined && num > schema.max) {
    return {
      valid: false,
      message: `"${entry.key}" value ${num} exceeds maximum ${schema.max}`,
      severity: 'error',
      suggestion: `Set "${entry.key}" to at most ${schema.max}`,
    };
  }

  return {
    valid: true,
    message: `"${entry.key}" is within range [${schema.min ?? '−∞'}, ${schema.max ?? '∞'}]`,
    severity: 'info',
  };
}

/**
 * Rule: noEmpty — no empty values unless marked optional.
 * @type {RuleFunction}
 */
function noEmpty(entry, schema) {
  if (entry.value !== '') return null;
  if (schema && schema.optional) return null;

  return {
    valid: false,
    message: `"${entry.key}" has an empty value`,
    severity: 'warning',
    suggestion: `Set a value for "${entry.key}" or mark it as @optional`,
  };
}

/**
 * Rule: noOrphan — keys in .env that are not in .env.example.
 * Uses the allSchema map to determine which keys are documented.
 *
 * @type {RuleFunction}
 */
function noOrphan(entry, schema, allEntries, allSchema) {
  // If there is no schema at all (empty schema file), skip
  if (!allSchema || Object.keys(allSchema).length === 0) return null;

  if (!(entry.key in allSchema)) {
    return {
      valid: false,
      message: `"${entry.key}" exists in .env but is not documented in the schema`,
      severity: 'warning',
      suggestion: `Add "${entry.key}" to your .env.example file`,
    };
  }
  return null;
}

/**
 * Rule: noDuplicate — no duplicate keys in the file.
 * @type {RuleFunction}
 */
function noDuplicate(entry, _schema, allEntries) {
  const occurrences = allEntries.filter(e => e.key === entry.key);
  if (occurrences.length <= 1) return null;

  // Only report on the second (and subsequent) occurrence(s)
  const firstOccurrence = occurrences[0];
  if (entry.line === firstOccurrence.line) return null;

  return {
    valid: false,
    message: `"${entry.key}" is duplicated (first defined on line ${firstOccurrence.line})`,
    severity: 'warning',
    suggestion: `Remove the duplicate definition of "${entry.key}"`,
  };
}

/**
 * Rule: noInterpolationMissing — referenced ${VAR} variables must exist.
 * @type {RuleFunction}
 */
function noInterpolationMissing(entry, _schema, allEntries) {
  const refs = extractInterpolations(entry.value);
  if (refs.length === 0) return null;

  const definedKeys = new Set(allEntries.map(e => e.key));
  const missing = refs.filter(r => !definedKeys.has(r));

  if (missing.length > 0) {
    return {
      valid: false,
      message: `"${entry.key}" references undefined variable(s): ${missing.map(m => '${' + m + '}').join(', ')}`,
      severity: 'error',
      suggestion: `Define ${missing.join(', ')} in your .env file`,
    };
  }

  return {
    valid: true,
    message: `"${entry.key}" interpolation references are all defined`,
    severity: 'info',
  };
}

module.exports = {
  required,
  type,
  pattern,
  range,
  noEmpty,
  noOrphan,
  noDuplicate,
  noInterpolationMissing,
};
