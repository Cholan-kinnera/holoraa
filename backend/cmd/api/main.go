// Command api is the Holoraa API server entry point.
//
// Usage:
//
//	api -version
//	api serve
//	api migrate up|down|status
//
// Configuration comes from environment variables. See internal/config.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/app"
	"github.com/Cholan-kinnera/holoraa/backend/internal/config"
	"github.com/Cholan-kinnera/holoraa/backend/internal/logging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/store"
	"github.com/Cholan-kinnera/holoraa/backend/internal/version"
)

// Exit codes. 2 means the command line or configuration was wrong; 1 means the
// command ran and failed.
const (
	exitOK    = 0
	exitFail  = 1
	exitUsage = 2
)

// migrateTimeout bounds one migration run.
const migrateTimeout = 5 * time.Minute

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// emit writes a formatted line and returns any write error, so callers can
// report a failed write instead of discarding it.
func emit(w io.Writer, format string, args ...any) error {
	_, err := fmt.Fprintf(w, format, args...)
	return err
}

// reject writes a message and returns code. If the write itself fails, the
// process exits with exitFail, because the user cannot see the reason.
func reject(w io.Writer, code int, format string, args ...any) int {
	if err := emit(w, format, args...); err != nil {
		return exitFail
	}
	return code
}

// run parses args and returns the process exit code. Output writers are
// parameters so the command can be tested without starting a process.
func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("api", flag.ContinueOnError)
	fs.SetOutput(stderr)
	showVersion := fs.Bool("version", false, "print the version and exit")

	if err := fs.Parse(args); err != nil {
		// -h and -help are not errors: flag has already printed the usage.
		if errors.Is(err, flag.ErrHelp) {
			return exitOK
		}
		return exitUsage
	}

	if *showVersion {
		return reject(stdout, exitOK, "%s\n", version.String())
	}

	rest := fs.Args()
	if len(rest) == 0 {
		return reject(stderr, exitUsage, "api: no command given; use -version, serve, or migrate\n")
	}

	switch rest[0] {
	case "serve":
		return runServe(stderr)
	case "migrate":
		return runMigrate(rest[1:], stdout, stderr)
	default:
		return reject(stderr, exitUsage, "api: unknown command %q; use -version, serve, or migrate\n", rest[0])
	}
}

func loadConfig(stderr io.Writer) (config.Config, bool) {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		// Printing the error is safe: config errors name the setting, never its value.
		_ = reject(stderr, exitUsage, "api: %v\n", err)
		return config.Config{}, false
	}
	return cfg, true
}

func runServe(stderr io.Writer) int {
	cfg, ok := loadConfig(stderr)
	if !ok {
		return exitUsage
	}
	log := logging.New(os.Stdout, cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := app.Serve(ctx, cfg, log); err != nil {
		log.Error("server stopped with error", "error", err.Error())
		return exitFail
	}
	return exitOK
}

func runMigrate(args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 {
		return reject(stderr, exitUsage, "api: usage: migrate up|down|status\n")
	}
	op := store.MigrationOp(args[0])
	switch op {
	case store.OpUp, store.OpDown, store.OpStatus:
	default:
		return reject(stderr, exitUsage, "api: unknown migration %q; use up, down, or status\n", args[0])
	}

	cfg, ok := loadConfig(stderr)
	if !ok {
		return exitUsage
	}
	log := logging.New(stderr, slog.LevelInfo)

	ctx, cancel := context.WithTimeout(context.Background(), migrateTimeout)
	defer cancel()

	statuses, err := store.Migrate(ctx, cfg.DatabaseURL, op)
	if err != nil {
		log.Error("migration failed", "op", string(op), "error", err.Error())
		return exitFail
	}
	for _, s := range statuses {
		if err := emit(stdout, "%-8s %s\n", s.State, s.Source.Path); err != nil {
			log.Error("write migration status", "error", err.Error())
			return exitFail
		}
	}
	log.Info("migration complete", "op", string(op))
	return exitOK
}
