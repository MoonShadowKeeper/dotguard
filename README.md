<div align="center">
  <h1>🛡️ dotguard</h1>
  <p><strong>Universal .env file validator — validate, lint, and enforce environment variable schemas</strong></p>

  <p>
    <img alt="npm version" src="https://img.shields.io/npm/v/dotguard?color=blue&style=flat-square" />
    <img alt="license" src="https://img.shields.io/npm/l/dotguard?style=flat-square" />
    <img alt="node" src="https://img.shields.io/node/v/dotguard?style=flat-square" />
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/MoonShadowKeeper/dotguard/validate-env.yml?style=flat-square&label=CI" />
  </p>

  <p>
    <a href="#installation">Installation</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#schema-annotations">Schema</a> •
    <a href="#cicd-integration">CI/CD</a> •
    <a href="#programmatic-api">API</a>
  </p>
</div>

---

## The Problem

Every team has been there:

> _"Why is production down?"_
> _"Someone deployed without `DATABASE_URL`."_

Environment variables are the **backbone of modern application configuration**, yet they remain one of the most fragile parts of any deployment pipeline. Teams create `.env.example` files with good intentions, but:

- ❌ Nobody validates `.env` files against the example
- ❌ Typos in variable names go unnoticed until runtime
- ❌ Type mismatches (`PORT=abc`) silently break things
- ❌ Required variables are missing with no warning
- ❌ New team members copy `.env.example` and forget to fill in secrets
- ❌ CI/CD pipelines deploy with incomplete configuration

**dotguard** fixes all of this. Define your schema once in `.env.example` using simple annotations, then validate everywhere — locally, in CI, and programmatically.

```
$ dotguard validate

  🛡️  dotguard v1.0.0

  Validating .env against .env.example...

  ✖ JWT_SECRET — failed min length check (expected ≥ 32, got 5)
  ⚠ EXTRA_VAR — variable not defined in schema (orphan)
  ✔ APP_NAME — valid
  ✔ NODE_ENV — valid
  ✔ PORT — valid
  ✔ DATABASE_URL — valid
  ✔ REDIS_URL — valid
  ✔ DEBUG — valid
  ✔ API_VERSION — valid

  Results: 7 passed · 1 failed · 1 warning

  ✖ Validation failed
```

---

## Installation

### Global install

```bash
npm install -g @moonshadows/dotguard
```

### Project-local (recommended)

```bash
npm install --save-dev @moonshadows/dotguard
```

### One-off usage

```bash
npx @moonshadows/dotguard validate
```

### Requirements

- Node.js **18.0.0** or later

---

## Quick Start

Get up and running in three steps:

### Step 1 — Add schema annotations to your `.env.example`

```bash
# @type url
# @required
# @description PostgreSQL connection string
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# @type port
# @required
# @default 3000
PORT=3000

# @type enum(development,staging,production)
# @required
NODE_ENV=development
```

### Step 2 — Create your `.env` file

```bash
cp .env.example .env
# Edit .env with your actual values
```

### Step 3 — Validate

```bash
npx dotguard validate
```

That's it. dotguard reads the schema annotations from `.env.example`, then validates every variable in your `.env` file against those rules.

---

## Schema Annotations

Schema annotations are special comments placed **directly above** an environment variable in your `.env.example` file. Each annotation starts with `# @`.

### `@type`

Specifies the expected data type for the variable's value.

| Type | Description | Example valid values |
|------|-------------|---------------------|
| `string` | Any string value (default) | `hello`, `my-app` |
| `number` | Numeric value (integer or float) | `42`, `3.14`, `-10` |
| `integer` | Integer only | `42`, `0`, `-7` |
| `boolean` | Boolean flag | `true`, `false`, `1`, `0`, `yes`, `no` |
| `url` | Valid URL | `https://example.com`, `redis://localhost:6379` |
| `email` | Valid email address | `user@example.com` |
| `port` | Valid port number (1–65535) | `3000`, `8080`, `443` |
| `enum(a,b,c)` | One of the listed values | `a`, `b`, or `c` |
| `hex` | Hexadecimal string | `a1b2c3`, `DEADBEEF` |
| `base64` | Base64-encoded string | `aGVsbG8=` |
| `json` | Valid JSON string | `{"key":"value"}` |

```bash
# @type url
DATABASE_URL=postgres://localhost:5432/mydb

# @type enum(debug,info,warn,error)
LOG_LEVEL=info

# @type port
PORT=8080

# @type boolean
ENABLE_CACHE=true

# @type json
FEATURE_FLAGS={"darkMode":true,"beta":false}
```

### `@required` / `@optional`

Marks whether a variable **must** be present and non-empty.

```bash
# @type string
# @required
# @description This MUST be set or validation fails
API_KEY=your-api-key-here

# @type string
# @optional
# @description Nice to have, but not critical
ANALYTICS_ID=
```

> **Default behavior:** Variables are treated as `@required` unless explicitly marked `@optional`.

### `@default`

Specifies a fallback value. When a variable is missing from `.env`, dotguard treats it as if it has this value (for validation purposes only — it does not modify your `.env` file).

```bash
# @type port
# @optional
# @default 3000
PORT=3000
```

### `@pattern`

Validates the value against a regular expression.

```bash
# @type string
# @required
# @pattern ^v\d+\.\d+\.\d+$
# @description Semantic version string (e.g., v1.2.3)
API_VERSION=v1.0.0

# @type string
# @required
# @pattern ^sk_(live|test)_[a-zA-Z0-9]{24,}$
# @description Stripe secret key
STRIPE_SECRET_KEY=sk_test_REPLACE_WITH_YOUR_KEY
```

### `@min` / `@max`

Sets length constraints for strings or value constraints for numbers.

```bash
# @type string
# @required
# @min 32
# @description Must be at least 32 characters
JWT_SECRET=your-very-long-secret-key-here-minimum-32-chars

# @type integer
# @required
# @min 1
# @max 100
# @description Worker thread count
WORKER_COUNT=4
```

### `@description`

Provides a human-readable description. Shown in validation output and generated docs.

```bash
# @type url
# @required
# @description PostgreSQL connection string for the primary database
DATABASE_URL=postgres://localhost:5432/mydb
```

### Full annotation example

```bash
# Application Configuration
# @type string
# @required
# @description Application name displayed in the UI
APP_NAME=MyApp

# @type enum(development,staging,production)
# @required
# @description Current environment
NODE_ENV=development

# @type port
# @required
# @default 3000
# @description Server listen port
PORT=3000

# @type url
# @required
# @description PostgreSQL connection string
DATABASE_URL=postgres://user:pass@localhost:5432/mydb

# @type string
# @required
# @min 32
# @description JWT signing secret (min 32 chars)
JWT_SECRET=change-me-to-a-real-secret-at-least-32-characters

# @type email
# @optional
# @description Notification recipient
ADMIN_EMAIL=admin@example.com

# @type boolean
# @optional
# @default false
# @description Enable verbose debug logging
DEBUG=false
```

---

## CLI Commands

### `dotguard validate`

Validate your `.env` file against the `.env.example` schema.

```bash
dotguard validate [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --env <path>` | Path to the `.env` file | `.env` |
| `-s, --schema <path>` | Path to the schema/example file | `.env.example` |
| `-f, --format <type>` | Output format: `pretty`, `json`, `compact` | `pretty` |
| `--strict` | Treat warnings (orphan vars) as errors | `false` |
| `--no-color` | Disable colored output | `false` |
| `--quiet` | Only output on failure | `false` |

```bash
# Validate with defaults
dotguard validate

# Validate a specific environment
dotguard validate -e .env.staging -s .env.example

# JSON output for CI parsing
dotguard validate --format json

# Strict mode — orphan vars cause failure
dotguard validate --strict
```

**Example JSON output:**

```json
{
  "valid": false,
  "passed": 7,
  "failed": 1,
  "warnings": 1,
  "results": [
    { "variable": "APP_NAME", "status": "pass" },
    { "variable": "JWT_SECRET", "status": "fail", "rule": "min", "message": "expected min length 32, got 5" },
    { "variable": "EXTRA_VAR", "status": "warn", "message": "variable not defined in schema" }
  ]
}
```

### `dotguard init`

Generate a starter `.env.example` with annotations from an existing `.env` file.

```bash
dotguard init [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --env <path>` | Source `.env` file to analyze | `.env` |
| `-o, --output <path>` | Output file path | `.env.example` |
| `--infer-types` | Attempt to auto-detect types | `true` |
| `--overwrite` | Overwrite existing output file | `false` |

```bash
# Generate .env.example from your .env
dotguard init

# From a specific file
dotguard init -e .env.production -o .env.example
```

### `dotguard diff`

Show differences between your `.env` file and the schema.

```bash
dotguard diff [options]
```

```bash
$ dotguard diff

  🔍 Comparing .env ↔ .env.example

  Missing from .env (defined in schema):
    + SENTRY_DSN (optional)

  Extra in .env (not in schema):
    - EXTRA_VAR

  Value differences:
    ~ JWT_SECRET — schema default has 43 chars, .env has 5 chars
```

### `dotguard sync`

Interactively synchronize your `.env` with the schema. Adds missing variables with their defaults and optionally removes orphans.

```bash
dotguard sync [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-e, --env <path>` | Path to the `.env` file | `.env` |
| `-s, --schema <path>` | Path to the schema file | `.env.example` |
| `--dry-run` | Preview changes without writing | `false` |
| `--remove-orphans` | Remove variables not in schema | `false` |

```bash
# Preview what sync would do
dotguard sync --dry-run

# Sync and remove orphan variables
dotguard sync --remove-orphans
```

---

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/validate-env.yml
name: Validate Environment
on: [push, pull_request]

jobs:
  dotguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npx dotguard validate --strict --format compact
```

### GitLab CI

```yaml
# .gitlab-ci.yml
validate-env:
  image: node:20-alpine
  stage: lint
  script:
    - npx dotguard validate --strict
  rules:
    - changes:
        - .env.example
        - .dotguardrc.json
```

### Pre-commit Hook

Using [husky](https://typicode.github.io/husky/):

```bash
npm install --save-dev husky
npx husky init
echo "npx dotguard validate" > .husky/pre-commit
```

Or add it to your `package.json`:

```json
{
  "scripts": {
    "precommit": "dotguard validate",
    "validate:env": "dotguard validate --strict"
  }
}
```

### Docker

```dockerfile
FROM node:20-alpine AS validate
WORKDIR /app
COPY .env.example .env ./
RUN npx dotguard validate --strict

FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci
CMD ["node", "server.js"]
```

---

## Programmatic API

Use dotguard as a library in your Node.js application:

### Basic validation

```js
const { validate } = require('dotguard');

const result = await validate({
  envPath: '.env',
  schemaPath: '.env.example',
});

if (!result.valid) {
  console.error('Environment validation failed:');
  for (const error of result.errors) {
    console.error(`  ✖ ${error.variable}: ${error.message}`);
  }
  process.exit(1);
}
```

### Parsing a schema

```js
const { parseSchema } = require('dotguard');

const schema = parseSchema('.env.example');
// Returns an array of variable definitions:
// [
//   {
//     name: 'DATABASE_URL',
//     type: 'url',
//     required: true,
//     description: 'PostgreSQL connection string',
//     example: 'postgres://user:pass@localhost:5432/mydb'
//   },
//   ...
// ]
```

### Custom validators

```js
const { validate, registerValidator } = require('dotguard');

// Register a custom type validator
registerValidator('aws-arn', (value) => {
  const arnRegex = /^arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+$/;
  if (!arnRegex.test(value)) {
    return { valid: false, message: 'Invalid AWS ARN format' };
  }
  return { valid: true };
});

// Now you can use @type aws-arn in your schema
```

### Startup guard

Add this to your application entry point to prevent startup with invalid config:

```js
// server.js
const { guard } = require('dotguard');

// Throws if validation fails — prevents app startup
await guard();

// Your app continues only if all env vars are valid
const app = require('./app');
app.listen(process.env.PORT);
```

---

## Configuration

Create a `.dotguardrc.json` in your project root to customize behavior:

```json
{
  "envFile": ".env",
  "schemaFile": ".env.example",
  "strict": false,
  "format": "pretty",
  "rules": {
    "no-orphans": "warn",
    "require-description": false,
    "require-type": false
  },
  "ignore": [
    "HOSTNAME",
    "npm_*"
  ]
}
```

### Configuration options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `envFile` | `string` | `".env"` | Path to the `.env` file |
| `schemaFile` | `string` | `".env.example"` | Path to the schema file |
| `strict` | `boolean` | `false` | Treat warnings as errors |
| `format` | `string` | `"pretty"` | Output format: `pretty`, `json`, `compact` |
| `rules.no-orphans` | `string` | `"warn"` | `"warn"`, `"error"`, or `"off"` |
| `rules.require-description` | `boolean` | `false` | Require `@description` on all vars |
| `rules.require-type` | `boolean` | `false` | Require `@type` on all vars |
| `ignore` | `string[]` | `[]` | Glob patterns for variables to skip |

---

## Comparison

How does dotguard stack up against alternatives?

| Feature | 🛡️ dotguard | dotenv-safe | env-cmd | envalid |
|---------|:-----------:|:-----------:|:-------:|:-------:|
| Schema in `.env.example` | ✅ | ✅ | ❌ | ❌ |
| Type validation | ✅ | ❌ | ❌ | ✅ |
| Pattern matching (regex) | ✅ | ❌ | ❌ | ✅ |
| Min/max constraints | ✅ | ❌ | ❌ | ❌ |
| Enum support | ✅ | ❌ | ❌ | ✅ |
| CLI tool | ✅ | ❌ | ✅ | ❌ |
| CI/CD friendly | ✅ | ⚠️ | ⚠️ | ⚠️ |
| Orphan detection | ✅ | ❌ | ❌ | ❌ |
| Diff command | ✅ | ❌ | ❌ | ❌ |
| Sync command | ✅ | ❌ | ❌ | ❌ |
| JSON output | ✅ | ❌ | ❌ | ❌ |
| Zero dependencies | ✅ | ✅ | ❌ | ❌ |
| Schema annotations | ✅ | ❌ | ❌ | ❌ |
| Init from existing `.env` | ✅ | ❌ | ❌ | ❌ |
| Programmatic API | ✅ | ✅ | ❌ | ✅ |

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/dotguard.git`
3. **Install** dependencies: `npm install`
4. **Create a branch**: `git checkout -b feat/my-feature`
5. **Make changes** and add tests
6. **Run tests**: `node test/run.js`
7. **Commit** with a clear message: `git commit -m "feat: add X"`
8. **Push** and open a Pull Request

### Development commands

```bash
# Run all tests
node test/run.js

# Validate the project's own .env
node bin/dotguard.js validate

# Run with debug output
DEBUG=true node bin/dotguard.js validate
```

### Guidelines

- 📝 Write JSDoc comments on all public functions
- ✅ Add tests for every new feature or bug fix
- 🚫 No external runtime dependencies — keep it zero-dep
- 🎨 Follow the existing code style
- 📖 Update the README for user-facing changes

---

## License

[MIT](./LICENSE) © 2025 dotguard contributors

---

<div align="center">
  <p>
    <sub>Built with ☕ and a healthy distrust of unchecked environment variables.</sub>
  </p>
</div>
