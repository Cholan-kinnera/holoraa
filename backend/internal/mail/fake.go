package mail

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Fake writes each message to a new file in Dir. The directory and files are
// private to the developer (0700 and 0600). Nothing is sent over a network,
// and no credentials are read.
type Fake struct {
	Dir string
	now func() time.Time
}

// NewFake returns a fake sender that writes into dir. The directory is created
// on first send.
func NewFake(dir string) *Fake {
	return &Fake{Dir: dir, now: time.Now}
}

// Send writes the message to a new file. The file name holds a timestamp and
// random bytes, never the recipient address.
func (f *Fake) Send(_ context.Context, m Message) error {
	if err := os.MkdirAll(f.Dir, 0o700); err != nil {
		return fmt.Errorf("create outbox directory: %w", err)
	}
	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		return errors.New("create outbox file name: randomness unavailable")
	}
	name := fmt.Sprintf("%s-%s.txt", f.now().UTC().Format("20060102T150405.000000000Z"), hex.EncodeToString(suffix))

	var b strings.Builder
	fmt.Fprintf(&b, "To: %s\nSubject: %s\n\n%s\n", m.To, m.Subject, m.Text)

	file, err := os.OpenFile(filepath.Join(f.Dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create outbox file: %w", err)
	}
	if _, err := file.WriteString(b.String()); err != nil {
		_ = file.Close()
		return fmt.Errorf("write outbox file: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close outbox file: %w", err)
	}
	return nil
}
