package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/Cholan-kinnera/holoraa/backend/internal/version"
)

func TestRunVersionFlagPrintsVersionAndExitsZero(t *testing.T) {
	var stdout, stderr bytes.Buffer

	code := run([]string{"-version"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0 (stderr: %q)", code, stderr.String())
	}
	want := version.String() + "\n"
	if stdout.String() != want {
		t.Fatalf("stdout = %q, want %q", stdout.String(), want)
	}
	if strings.TrimSpace(stdout.String()) == "" {
		t.Fatal("version output is empty")
	}
}

func TestRunWithoutCommandExitsTwo(t *testing.T) {
	var stdout, stderr bytes.Buffer

	code := run(nil, &stdout, &stderr)

	if code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
	if stderr.Len() == 0 {
		t.Fatal("expected a usage message on stderr")
	}
}

func TestRunHelpFlagExitsZeroAndPrintsUsage(t *testing.T) {
	for _, arg := range []string{"-h", "-help"} {
		var stdout, stderr bytes.Buffer

		code := run([]string{arg}, &stdout, &stderr)

		if code != 0 {
			t.Fatalf("%s: exit code = %d, want 0", arg, code)
		}
		if !strings.Contains(stderr.String(), "-version") {
			t.Fatalf("%s: usage on stderr does not mention -version: %q", arg, stderr.String())
		}
	}
}

func TestRunUnknownFlagExitsTwo(t *testing.T) {
	var stdout, stderr bytes.Buffer

	code := run([]string{"-nope"}, &stdout, &stderr)

	if code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
}
