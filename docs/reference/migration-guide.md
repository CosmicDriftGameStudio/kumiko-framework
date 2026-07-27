---
title: Migration Guide
description: Breaking changes and migration hints for Kumiko upgrades
status: reference
---

# Migration Guide

This document lists breaking changes across all bundled features.
Use `kumiko upgrade` to check what's new since your current version.

## 0.166.0

### delivery

**SSE payload format changed**

Event payload is now the stored event format instead of the old system:event wrapper

**Migration:** Update SSE consumers to expect { type, data: { id, aggregateType, version, payload, createdAt } }
