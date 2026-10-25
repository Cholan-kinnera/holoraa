# Database access and least privilege — Holoraa (v2)

- **Purpose:** What database permissions the development setup has today (verified), and what production must enforce (required, not yet implemented).
- **Owner:** TODO(owner): Database Administrator
- **Status:** Draft. The production requirements are not implemented or tested. The SQL in section 4 is a template for a platform administrator to review. Nothing in this repository runs it.
- **Last Updated:** 2026-10-25

---

## 1. Development (verified on 2026-10-25)

Container `holoraa-v2-postgres`, PostgreSQL 17.11, database `holoraa_dev`.

| Item | Observed | Acceptable for development? |
|---|---|---|
| Application role `holoraa` | Superuser; can create databases and roles; replication and row-level-security bypass attributes set; can log in | Yes, on a developer's loopback only. Never in production. |
| Database owner | `holoraa` owns `holoraa_dev` | Yes |
| `public` schema | Owned by `pg_database_owner`; `PUBLIC` has no CREATE privilege | Yes, and matches the PostgreSQL 15+ default |
| Password encryption | `scram-sha-256` | Yes |
| Host authentication | Inside the container, localhost is `trust`. Connections from the host arrive through the Docker bridge and hit `scram-sha-256`. Verified: a host connection without a password fails with "no password supplied". | Acceptable. The `trust` rule applies only inside the container. |
| Network binding | Compose publishes `127.0.0.1:5433` only | Yes |
| TLS | `ssl = off` | Acceptable on loopback only |

Why the superuser role is used in development: integration tests create and drop scratch databases (`holoraa_test_*`), which needs `CREATEDB`. The application itself needs far less.

## 2. Production requirements (not yet implemented)

These are required before any non-development deployment.

1. **Separate roles.**
   - A migration role that owns the schema and runs goose migrations. It is not a superuser, and it has no `CREATEDB`, `CREATEROLE`, `REPLICATION` or `BYPASSRLS`.
   - A runtime role for the API. It has only the DML privileges it needs (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on application tables. It has no DDL rights and owns nothing.
   - A backup role, if backups use database credentials.
2. **No superuser for any running service.** Superuser access is for administrators only, through a separate, audited path.
3. **Connection limits and timeouts** on the runtime role: a connection limit, `statement_timeout`, and `idle_in_transaction_session_timeout`.
4. **TLS for every client connection**, with certificate verification (`verify-full`) from the API. `pg_hba` allows `hostssl` rules only. No `trust` rule and no unencrypted `host` rule.
5. **Authentication:** `scram-sha-256` only.
6. **Separate credentials per role**, supplied from a secret manager. Never in a committed file, an image, or a log. Rotation follows [../runbooks/rotating-secrets.md](../runbooks/rotating-secrets.md).
7. **No integration test against production.** The test suite creates databases, so it must run only against a dedicated test instance.
8. **Public schema.** `PUBLIC` keeps no CREATE privilege on `public`, and the database is not accessible to `PUBLIC`.
9. **Future tables.** Each new table is granted to the runtime role explicitly, in the migration that creates it. Default privileges set by the migration role keep grants consistent.

## 3. What to verify before production

| Check | How | Expected |
|---|---|---|
| Runtime role is not a superuser | `select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = '<runtime role>'` | all false |
| Runtime role cannot create tables | `create table _probe (id int);` as the runtime role | permission denied |
| `PUBLIC` cannot connect | `select has_database_privilege('public', '<database>', 'CONNECT');` | false |
| `PUBLIC` cannot create in `public` | `select has_schema_privilege('public', 'public', 'CREATE');` | false |
| TLS is required | `show ssl;` and the `pg_hba` file | `on`; `hostssl` rules only |
| Password encryption | `show password_encryption;` | `scram-sha-256` |

## 4. Template (for review; not executed)

```sql
-- Run once by a platform administrator. Supply passwords through a secret manager.
-- Do not write literal passwords in this file or in any shared script.

CREATE ROLE holoraa_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE holoraa_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;

ALTER ROLE holoraa_app SET statement_timeout = '5s';
ALTER ROLE holoraa_app SET idle_in_transaction_session_timeout = '10s';

CREATE DATABASE holoraa OWNER holoraa_migrator;
REVOKE ALL ON DATABASE holoraa FROM PUBLIC;
GRANT CONNECT ON DATABASE holoraa TO holoraa_app;

-- Connect to the database, then:
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO holoraa_app;

-- After the first migrations create tables, the migration role grants DML by default:
ALTER DEFAULT PRIVILEGES FOR ROLE holoraa_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO holoraa_app;
ALTER DEFAULT PRIVILEGES FOR ROLE holoraa_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO holoraa_app;
```

`pg_hba.conf` for production has no `trust` or unencrypted `host` lines. Its rules look like this (for review):

```
hostssl  holoraa  holoraa_app       <app network>  scram-sha-256
hostssl  holoraa  holoraa_migrator  <admin network> scram-sha-256
```

## 5. Open items

- `TODO(owner)`: the production host, TLS certificate source, and network ranges.
- `TODO(owner)`: whether the migration role runs from CI or from an operator's machine.
- `TODO(owner)`: connection limit and timeout values, after load testing.
- Production PostgreSQL version and image are open under D4. The development image is provisional.
