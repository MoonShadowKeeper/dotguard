'use strict';

const { parseEnvFile, parseEnvContent } = require('./parser');
const builtinRules = require('./rules');

/**
 * @typedef {import('./parser').EnvEntry}        EnvEntry
 * @typedef {import('./parser').SchemaAnnotation} SchemaAnnotation
 * @typedef {import('./rules').RuleResult}        RuleResult
 */

/**
 * @typedef {Object} ValidationResult
 * @property {string}                   key        — Variable name
 * @property {string}                   rule       — Name of the rule that produced this result
 * @property {'error'|'warning'|'info'} severity   — Result severity
 * @property {string}                   message    — Human-readable message
 * @property {number}                   line       — Line number in the .env file
 * @property {string}                   [suggestion] — Optional fix suggestion
 */

/**
 * @typedef {Object} ValidationSummary
 * @property {number}             passed   — Number of passed checks
 * @property {number}             failed   — Number of failed checks (errors)
 * @property {number}             warnings — Number of warnings
 * @property {ValidationResult[]} results  — All individual results
 */

/**
 * @typedef {Object} ValidateOptions
 * @property {boolean}  [strict=false]       — Treat warnings as errors
 * @property {boolean}  [ignoreOrphans=false] — Skip the noOrphan rule
 * @property {Object[]} [customRules=[]]     — Additional rule functions: { name, fn }
 */

/**
 * Build the list of rules to run, respecting options.
 *
 * @param {ValidateOptions} options
 * @returns {Array<{ name: string, fn: Function }>}
 */
function buildRuleList(options = {}) {
  const rules = [];

  for (const [name, fn] of Object.entries(builtinRules)) {
    if (name === 'noOrphan' && options.ignoreOrphans) continue;
    rules.push({ name, fn });
  }

  if (Array.isArray(options.customRules)) {
    for (const custom of options.customRules) {
      if (custom && typeof custom.fn === 'function' && custom.name) {
        rules.push(custom);
      }
    }
  }

  return rules;
}

/**
 * Run all applicable rules against a single entry.
 *
 * @param {EnvEntry}                            entry
 * @param {SchemaAnnotation|undefined}          schema
 * @param {EnvEntry[]}                          allEntries
 * @param {Record<string, SchemaAnnotation>}    allSchema
 * @param {Array<{ name: string, fn: Function }>} rules
 * @returns {ValidationResult[]}
 */
function runRulesForEntry(entry, schema, allEntries, allSchema, rules) {
  /** @type {ValidationResult[]} */
  const results = [];

  for (const { name, fn } of rules) {
    try {
      const result = fn(entry, schema, allEntries, allSchema);
      if (!result) continue;

      results.push({
        key: entry.key,
        rule: name,
        severity: result.severity,
        message: result.message,
        line: entry.line,
        suggestion: result.suggestion,
      });
    } catch (err) {
      results.push({
        key: entry.key,
        rule: name,
        severity: 'error',
        message: `Rule "${name}" threw an error: ${err.message}`,
        line: entry.line,
      });
    }
  }

  return results;
}

/**
 * Check for required keys defined in the schema that are missing from the .env file.
 *
 * @param {EnvEntry[]}                          envEntries
 * @param {Record<string, SchemaAnnotation>}    schemaMap
 * @param {EnvEntry[]}                          schemaEntries
 * @returns {ValidationResult[]}
 */
function checkMissingRequired(envEntries, schemaMap, schemaEntries) {
  /** @type {ValidationResult[]} */
  const results = [];
  const envKeys = new Set(envEntries.map(e => e.key));

  for (const [key, ann] of Object.entries(schemaMap)) {
    if (!ann.required) continue;
    if (envKeys.has(key)) continue;

    // Find line in schema file for better reporting
    const schemaEntry = schemaEntries.find(e => e.key === key);
    const line = schemaEntry ? schemaEntry.line : 0;

    results.push({
      key,
      rule: 'required',
      severity: 'error',
      message: `"${key}" is required but missing from the .env file`,
      line,
      suggestion: `Add "${key}" to your .env file`,
    });
  }

  return results;
}

/**
 * Validate an .env file against a schema file.
 *
 * @param {string}          envPath    — Path to the .env file
 * @param {string}          schemaPath — Path to the .env.example / schema file
 * @param {ValidateOptions} [options]  — Validation options
 * @returns {Promise<ValidationSummary>}
 */
async function validate(envPath, schemaPath, options = {}) {
  return validateSync(envPath, schemaPath, options);
}

/**
 * Synchronous validation of an .env file against a schema file.
 *
 * @param {string}          envPath    — Path to the .env file
 * @param {string}          schemaPath — Path to the .env.example / schema file
 * @param {ValidateOptions} [options]  — Validation options
 * @returns {ValidationSummary}
 */
function validateSync(envPath, schemaPath, options = {}) {
  const env = parseEnvFile(envPath);
  const schema = parseEnvFile(schemaPath);

  // Merge schema annotations from the schema file
  // Also include keys from the schema entries for orphan detection
  const mergedSchema = { ...schema.schema };

  // Ensure every key in the schema file has at least an empty annotation
  // so that noOrphan can detect undocumented keys
  for (const entry of schema.entries) {
    if (!(entry.key in mergedSchema)) {
      mergedSchema[entry.key] = {};
    }
  }

  const rules = buildRuleList(options);

  /** @type {ValidationResult[]} */
  let allResults = [];

  // Run rules for each entry in the .env file
  for (const entry of env.entries) {
    const entrySchema = mergedSchema[entry.key];
    const results = runRulesForEntry(entry, entrySchema, env.entries, mergedSchema, rules);
    allResults.push(...results);
  }

  // Check for required keys that are missing entirely
  const missingResults = checkMissingRequired(env.entries, mergedSchema, schema.entries);
  allResults.push(...missingResults);

  // In strict mode, upgrade warnings to errors
  if (options.strict) {
    allResults = allResults.map(r =>
      r.severity === 'warning' ? { ...r, severity: 'error' } : r,
    );
  }

  // Compute summary
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  for (const r of allResults) {
    if (r.severity === 'error' && !r.message.includes('matches') && !r.message.includes('is present')) {
      // Count by validity: results with valid=false land here with error severity
    }
    switch (r.severity) {
      case 'error':
        // Check if it's a pass or fail based on the message context
        // A cleaner way: look for results from rules that returned valid=true
        // Since we lose the `valid` flag in the mapping, we rely on convention:
        // failing rules use actionable language, passing rules use confirmations
        failed++;
        break;
      case 'warning':
        warnings++;
        break;
      case 'info':
        passed++;
        break;
    }
  }

  return {
    passed,
    failed,
    warnings,
    results: allResults,
  };
}

module.exports = {
  validate,
  validateSync,
};
