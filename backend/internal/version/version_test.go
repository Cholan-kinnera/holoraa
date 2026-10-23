package version

import "testing"

func TestStringIsNonEmptyByDefault(t *testing.T) {
	if got := String(); got == "" {
		t.Fatal("String() returned an empty version")
	}
}

func TestStringReturnsLinkedVersion(t *testing.T) {
	orig := Version
	t.Cleanup(func() { Version = orig })

	Version = "1.2.3"
	if got := String(); got != "1.2.3" {
		t.Fatalf("String() = %q, want %q", got, "1.2.3")
	}
}

func TestStringFallsBackWhenEmpty(t *testing.T) {
	orig := Version
	t.Cleanup(func() { Version = orig })

	Version = ""
	if got := String(); got != "unknown" {
		t.Fatalf("String() = %q, want %q", got, "unknown")
	}
}
