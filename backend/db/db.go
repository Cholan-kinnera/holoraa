// Package db embeds the forward-only SQL migrations so the API binary can apply them.
package db

import "embed"

// Migrations holds the goose migration files in db/migrations. Each file is
// named with a numeric prefix so goose applies them in order.
//
//go:embed migrations/*.sql
var Migrations embed.FS
