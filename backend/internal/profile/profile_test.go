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
	if got, err := ValidateDisplayName(strings.Repeat("a", 50)); err != nil || len(got) != 50 {
		t.Fatalf("50-char display name rejected: %v", err)
	}
	for _, in := range []string{"", "   ", strings.Repeat("x", 51), "bad\x07name", "new\nline", "car\rriage", "tab\tname"} {
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
	if got, err := ValidateBio("   "); err != nil || got != "" {
		t.Fatalf("whitespace-only bio should normalize to empty: %q, %v", got, err)
	}
	if got, err := ValidateBio("line 1\nline 2"); err != nil || got != "line 1\nline 2" {
		t.Fatalf("single internal newline must be preserved: got %q, %v", got, err)
	}
	if got, err := ValidateBio("line 1\n\n\nline 2"); err != nil || got != "line 1\nline 2" {
		t.Fatalf("consecutive newlines must collapse to single newline: got %q, %v", got, err)
	}
	if got, err := ValidateBio("line 1\r\n\r\nline 2"); err != nil || got != "line 1\nline 2" {
		t.Fatalf("crlf must normalize to single newline: got %q, %v", got, err)
	}
	if got, err := ValidateBio("clean\x00\x07bio\x1b"); err != nil || got != "cleanbio" {
		t.Fatalf("control characters must be stripped: got %q, %v", got, err)
	}
	if got, err := ValidateBio(strings.Repeat("b", 160)); err != nil || len(got) != 160 {
		t.Fatalf("160-character bio should be accepted: %v", err)
	}
	if _, err := ValidateBio(strings.Repeat("b", 161)); err == nil {
		t.Fatal("a 161-character bio was accepted")
	}
}

func TestValidateAvatarURL(t *testing.T) {
	if got, err := ValidateAvatarURL(" https://cdn.example.test/a.png "); err != nil || got != "https://cdn.example.test/a.png" {
		t.Fatalf("got %q, %v", got, err)
	}
	if got, err := ValidateAvatarURL(""); err != nil || got != "" {
		t.Fatalf("empty avatar URL should be accepted: %q, %v", got, err)
	}
	if got, err := ValidateAvatarURL("   "); err != nil || got != "" {
		t.Fatalf("whitespace avatar URL should normalize to empty: %q, %v", got, err)
	}

	bad := []string{
		"http://cdn.example.test/a.png",
		"javascript:alert(1)",
		"ftp://cdn.example.test/a.png",
		"https://user:pw@cdn.example.test/a",
		"https://",
		"https://cdn.example.test/a#frag",
		"https://" + strings.Repeat("a", 2050),
		// Local / internal hostnames
		"https://localhost/a.png",
		"https://localhost:8443/a.png",
		"https://127.0.0.1/a.png",
		"https://127.0.0.1:9000/a.png",
		"https://[::1]/a.png",
		"https://10.0.0.1/a.png",
		"https://172.16.0.1/a.png",
		"https://192.168.1.1/a.png",
		"https://169.254.169.254/latest/meta-data/",
		"https://internal-server/a.png",
		"https://service.local/a.png",
		"https://service.internal/a.png",
		"https://service.lan/a.png",
		"https://service.home.arpa/a.png",
	}
	for _, in := range bad {
		if _, err := ValidateAvatarURL(in); err == nil {
			t.Fatalf("ValidateAvatarURL(%q) accepted an unsafe or internal URL", in)
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
	u, err = validatePatch(Patch{Bio: Field{Present: true, Value: ""}})
	if err != nil || !u.bio.set || u.bio.value != nil {
		t.Fatalf("empty bio must clear the column: %+v, %v", u.bio, err)
	}
	u, err = validatePatch(Patch{AvatarURL: Field{Present: true, Null: true}})
	if err != nil || !u.avatarURL.set || u.avatarURL.value != nil {
		t.Fatalf("null avatarUrl must clear the column: %+v, %v", u.avatarURL, err)
	}
	u, err = validatePatch(Patch{AvatarURL: Field{Present: true, Value: ""}})
	if err != nil || !u.avatarURL.set || u.avatarURL.value != nil {
		t.Fatalf("empty avatarUrl must clear the column: %+v, %v", u.avatarURL, err)
	}
	u, err = validatePatch(Patch{})
	if err != nil || u.username.set || u.displayName.set || u.bio.set || u.avatarURL.set {
		t.Fatalf("an empty patch must change nothing: %+v, %v", u, err)
	}
}

func TestEscapeLikeWildcards(t *testing.T) {
	cases := map[string]string{
		"normal":          "normal",
		"100%":            `100\%`,
		"user_name":       `user\_name`,
		`path\file`:       `path\\file`,
		`100%_user\check`: `100\%\_user\\check`,
	}
	for in, want := range cases {
		if got := EscapeLikeWildcards(in); got != want {
			t.Fatalf("EscapeLikeWildcards(%q) = %q, want %q", in, got, want)
		}
	}
}
