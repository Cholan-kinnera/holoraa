package profile

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateUsername(t *testing.T) {
	ok := map[string]string{"alice": "alice", "  Bob_99 ": "bob_99", "abc": "abc"}
	for in, want := range ok {
		got, err := ValidateUsername(in)
		if err != nil || got != want {
			t.Fatalf("ValidateUsername(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	bad := []string{
		"ab",                      // too short
		strings.Repeat("a", 33),   // too long
		"1starts_with_digit",      // must start with a letter
		"has space",               // invalid character
		"dash-not-allowed",        // invalid character
		"unicodé",                 // non-ASCII
		"admin", "api", "holoraa", // reserved
		"me", "root", "support", "users", "v1",
	}
	for _, in := range bad {
		if _, err := ValidateUsername(in); err == nil {
			t.Fatalf("ValidateUsername(%q) accepted an invalid username", in)
		}
	}
}

func TestValidateDisplayName(t *testing.T) {
	if got, err := ValidateDisplayName("  Alice A.  "); err != nil || got != "Alice A." {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, in := range []string{"", "   ", strings.Repeat("x", 65), "bad\x07name", "new\nline"} {
		if _, err := ValidateDisplayName(in); err == nil {
			t.Fatalf("ValidateDisplayName(%q) accepted an invalid name", in)
		}
	}
}

func TestValidateBio(t *testing.T) {
	if got, err := ValidateBio("  hello  "); err != nil || got != "hello" {
		t.Fatalf("got %q, %v", got, err)
	}
	if got, err := ValidateBio(""); err != nil || got != "" {
		t.Fatalf("empty bio should be allowed: %q, %v", got, err)
	}
	if _, err := ValidateBio(strings.Repeat("b", 301)); err == nil {
		t.Fatal("a 301-character bio was accepted")
	}
	if _, err := ValidateBio("line\nbreak"); err == nil {
		t.Fatal("a bio with a control character was accepted")
	}
}

func TestValidateAvatarURL(t *testing.T) {
	if got, err := ValidateAvatarURL(" https://cdn.example.test/a.png "); err != nil || got != "https://cdn.example.test/a.png" {
		t.Fatalf("got %q, %v", got, err)
	}
	bad := []string{
		"", "http://cdn.example.test/a.png", "javascript:alert(1)", "https://user:pw@cdn.example.test/a",
		"https://", "https://cdn.example.test/a#frag", "https://" + strings.Repeat("a", 2050),
	}
	for _, in := range bad {
		if _, err := ValidateAvatarURL(in); err == nil {
			t.Fatalf("ValidateAvatarURL(%q) accepted an unsafe URL", in)
		}
	}
}

func TestValidationErrorsNameTheFieldNotTheValue(t *testing.T) {
	_, err := ValidateUsername("Secret Value!")
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("error = %v, want *ValidationError", err)
	}
	if ve.Field != "username" || strings.Contains(err.Error(), "Secret") {
		t.Fatalf("error %q must name the field and not echo the value", err.Error())
	}
}

func TestValidatePatchRules(t *testing.T) {
	if _, err := validatePatch(Patch{Username: Field{Present: true, Null: true}}); err == nil {
		t.Fatal("clearing username must be rejected")
	}
	if _, err := validatePatch(Patch{DisplayName: Field{Present: true, Null: true}}); err == nil {
		t.Fatal("clearing displayName must be rejected")
	}
	u, err := validatePatch(Patch{Bio: Field{Present: true, Null: true}})
	if err != nil || !u.bio.set || u.bio.value != nil {
		t.Fatalf("null bio must clear the column: %+v, %v", u.bio, err)
	}
	u, err = validatePatch(Patch{})
	if err != nil || u.username.set || u.displayName.set || u.bio.set || u.avatarURL.set {
		t.Fatalf("an empty patch must change nothing: %+v, %v", u, err)
	}
}
