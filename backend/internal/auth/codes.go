package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"math/big"
	"regexp"
	"strings"
)

// Input shapes. Every external input is checked here before use.
var (
	uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	codePattern = regexp.MustCompile(`^[0-9]{6}$`)
)

// codeModulus gives six decimal digits.
var codeModulus = big.NewInt(1000000)

// NormalizeEmail trims and lowercases an address and checks its shape. It is a
// shape check only: deliverability is not tested. The result is the key used
// for accounts, rate limits, and delivery.
func NormalizeEmail(raw string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(raw))
	if len(e) < 3 || len(e) > 254 {
		return "", ErrMalformed
	}
	if strings.ContainsAny(e, " \t\r\n") || strings.Count(e, "@") != 1 {
		return "", ErrMalformed
	}
	at := strings.IndexByte(e, '@')
	local, domain := e[:at], e[at+1:]
	if local == "" || len(local) > 64 || domain == "" {
		return "", ErrMalformed
	}
	if !strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") ||
		strings.HasSuffix(domain, ".") || strings.Contains(domain, "..") {
		return "", ErrMalformed
	}
	return e, nil
}

// validUUID reports whether s is a UUID in the canonical form.
func validUUID(s string) bool { return uuidPattern.MatchString(s) }

// validCode reports whether s is exactly six ASCII digits.
func validCode(s string) bool { return codePattern.MatchString(s) }

// randomCode returns a uniformly random six-digit code. crypto/rand.Int avoids
// modulo bias.
func randomCode(r io.Reader) (string, error) {
	n, err := rand.Int(r, codeModulus)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// newUUID returns a random version 4 UUID in canonical lowercase form.
func newUUID(r io.Reader) (string, error) {
	b := make([]byte, 16)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // RFC 4122 variant
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// newToken returns 32 random bytes encoded as base64url without padding.
func newToken(r io.Reader) (string, error) {
	b := make([]byte, 32)
	if _, err := io.ReadFull(r, b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
