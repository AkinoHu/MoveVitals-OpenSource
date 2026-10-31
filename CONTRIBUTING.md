# Contributing to MoveVitals

Thanks for helping! MoveVitals brings health and training data from many devices into one place, keeping every value's source and resolving conflicts transparently.

## Getting started

```bash
pnpm install
pnpm seed:demo   # demo@movevitals.local / demo-password with multi-source sample data
pnpm dev
```

No database setup is needed locally — an embedded PGlite database is created in `.data/`.

Before opening a PR:

```bash
pnpm typecheck
pnpm lint
```

## Ground rules

- **Official APIs only.** No scraping, reverse-engineered protocols or unofficial endpoints.
- **Never overwrite data from another source.** Write through `Ingestor` (`src/lib/ingest.ts`); conflict resolution happens in `src/lib/resolve.ts`.
- **Respect platform terms.** If a platform restricts AI use of its data, set `aiRestricted: true` in `src/lib/providers/catalog.ts`.
- **All UI text is translated.** Add new strings to every dictionary in `src/i18n/dict/` (English is the source of truth; TypeScript flags missing keys).
- **No secrets or personal data** in code, tests, fixtures, screenshots or issues.

## Adding a device or platform

See [docs/adding-a-provider.md](docs/adding-a-provider.md).

## Commit style

Short imperative subject line ("Add Suunto webhook verification"), with a body explaining *why* when it isn't obvious.

## License

By contributing you agree to the [Contributor License Agreement](CLA.md): your contributions are licensed under the [AGPL-3.0](LICENSE), and the maintainers may also use them in the hosted service and under other licences.
