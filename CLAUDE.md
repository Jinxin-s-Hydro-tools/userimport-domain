# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a **Hydro OJ addon** that extends the built-in `/manage/userimport` with domain enrollment and role assignment for batch user imports. It is a single-file Cordis-based plugin.

## Key commands

```bash
# Install the addon into a Hydro OJ instance
hydrooj addon add /path/to/user-import-with-domain
pm2 restart hydrooj

# The addon's AJAX URL once installed
/manage/userimport-domain

# User-facing entry point
/manage/userimport
```

There are no build, lint, or test commands — this is a single TypeScript file loaded directly by Hydro at runtime.

## Architecture

**Single-file plugin** (`index.ts`): All logic lives in one file. Hydro's Cordis-based plugin system loads it by calling the exported `apply(ctx)` function.

**Plugin registration** (`apply`):
- `ctx.Route(...)` — registers `/manage/userimport-domain` with `UserImportDomainHandler`
- `ctx.i18n.load(...)` — registers Chinese and English labels

**Handler** (`UserImportDomainHandler`):
- Requires `PRIV_EDIT_SYSTEM` privilege
- `get()` — redirects to the combined `/manage/userimport` page
- `post()` — parses input, validates, and either previews (`draft=true`) or commits (`draft=false`); used by the second form via AJAX

**Input parsing** (`parseLine`): Supports comma or tab delimiters, auto-detects column count (3–6 columns), mapping to email/username/password/displayName/domain/role.

**Validation** (in `post`): Inline regex validators (`isEmail`, `isUname`, `isPassword`) — Hydro does not export these. Duplicate detection within the input batch (email + username) and against the database (`UserModel.getByEmail`, `UserModel.getByUname`).

**Domain resolution** (`resolveDomain`): Tries `DomainModel.get(input)` first (matches `_id` like `system`), then falls back to `collDomain.findOne({ name: input })` (matches display name like `c++`). Domain and role lookups are cached per request in `Map`s.

**Import** (non-draft mode): Creates users via `UserModel.create()`, then optionally enrolls them via `DomainModel.setUserRole()`.

## Critical patterns

- **Model access**: Use `global.Hydro.model.user` / `global.Hydro.model.domain` inside handler methods — do NOT import them from the `hydrooj` package at module level; they are undefined at load time.
- **db access**: `db.collection('domain')` at module level is safe (db is connected by load time), but other db operations should stay inside `apply()` or handlers.
- **Entry file must be `index.ts`**: Cordis-based Hydro loads from this filename by convention.
- **No Control Panel sidebar item**: The addon intentionally does not call `ctx.injectUI('ControlPanel', ...)`; it replaces the built-in `/manage/userimport` template with a combined two-form page instead.
- **Templates**: Extend `manage_base.html` (which extends `layout/basic.html`). The `manage_content` block is where page content goes. CSRF token is accessed via `handler.csrfToken`.
