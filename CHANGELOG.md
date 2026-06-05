# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-06-05
### Fixed
- Changed package name to `@moonshadows/dotguard` to avoid npm naming collision.
- Fixed GitHub Actions CI pipeline to correctly use local binary and `npm install`.
- Updated test suite to use robust integration tests instead of outdated unit tests.
- Fixed `range` validator rule for string length checks.
- Fixed `url` validator rule to accept non-HTTP protocols (e.g. `postgres://`, `redis://`).

## [1.0.0] - 2026-06-05
### Added
- Initial release.
- Core schema parser and validator.
- Support for `@type`, `@required`, `@pattern`, `@min`, `@max`, `@default` annotations.
- Zero-dependency architecture.
