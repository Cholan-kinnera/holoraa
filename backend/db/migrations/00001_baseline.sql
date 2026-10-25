-- +goose Up
-- Baseline migration. It starts the migration history. It creates no
-- application tables. Each later schema change is added as a new numbered
-- migration, at the milestone that needs it.
SELECT 1;

-- +goose Down
-- Down exists so the migration round trip can be tested. Production uses
-- forward-only changes (see docs/engineering/DEPLOYMENT.md).
SELECT 1;
