// Command api is the Holoraa API server entry point.
//
// M0 provides only the version flag. The server itself is added in later milestones.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/Cholan-kinnera/holoraa/backend/internal/version"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run parses args and returns the process exit code. It takes its output
// writers as parameters so it can be tested without starting a process.
func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("api", flag.ContinueOnError)
	fs.SetOutput(stderr)
	showVersion := fs.Bool("version", false, "print the version and exit")

	if err := fs.Parse(args); err != nil {
		// -h and -help are not errors: flag has already printed the usage.
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		return 2
	}

	if *showVersion {
		if _, err := fmt.Fprintln(stdout, version.String()); err != nil {
			return 1
		}
		return 0
	}

	if _, err := fmt.Fprintln(stderr, "api: no command given; use -version"); err != nil {
		return 1
	}
	return 2
}
