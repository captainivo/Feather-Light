# River-Slate

River-Slate is Mithra's interpretation and digest service. This source-only copy was imported from
the running VM while that deployment remained online and unchanged.

The service reads Feather-Light state through a SQLite connection opened with `readonly` and
`fileMustExist`. Runtime databases, health-card output, credentials, logs, dependencies, and VM
configuration are not part of this directory.

Configure deployment through environment variables documented by `npm run start -- --help`, most
notably `FEATHER_LIGHT_DB`, `HEALTH_CARD_DIR`, and `AUTHORA_API_BASE_URL`.

`npm test` runs portable synthetic tests. The original VM integration checks remain under `test/`
as migration references but are excluded from the default suite because they intentionally require
private live state.
