// Package version holds the build version reported by the API binary.
package version

// Version is the build version. The default is overridden at link time:
//
//	-ldflags "-X github.com/Cholan-kinnera/holoraa/backend/internal/version.Version=<value>"
var Version = "0.0.0-dev"

// String returns the build version, or "unknown" if Version was linked as empty.
func String() string {
	if Version == "" {
		return "unknown"
	}
	return Version
}
