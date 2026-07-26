# @cosmicdrift/kumiko-types

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Framework type definitions for Kumiko — `FeatureDefinition`, boot-check types,
and the pure engine types. Lets downstream consumers build against the type
contracts without importing the whole framework package.

Also contains the identity-sensitive error classes (`event-store-errors.ts`,
`kms-adapter-types.ts`) as runtime code — `kumiko-framework`/
`kumiko-bundled-features` declare this package as a `peerDependency`
(single-copy constraint), not a plain dependency.

See the [monorepo root README](../../README.md) for the broader pitch.
