# @cosmicdrift/kumiko-types

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Framework type definitions for Kumiko — `FeatureDefinition`, boot-check types,
and the pure engine types. Lets downstream consumers build against the type
contracts without importing the whole framework package.

Carries no identity-sensitive runtime values: no classes, and brand symbols use
`Symbol.for`. Resolving two copies of this package is therefore harmless, so
`kumiko-framework`/`kumiko-bundled-features` declare it as a plain dependency.
The error classes callers branch on with `instanceof` live in `kumiko-framework`
(`/event-store`, `/crypto`), which stays a single copy.

See the [monorepo root README](../../README.md) for the broader pitch.
