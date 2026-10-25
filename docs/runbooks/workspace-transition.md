# Runbook: making the staging repository the primary working copy

- **Purpose:** Replace the legacy primary working copy with the verified v2 repository, safely and with a rollback path.
- **Owner:** TODO(owner): Repository Maintainer
- **Status:** Draft. Do not run any step without the owner's explicit approval, recorded in the session. The steps are reversible until step 6.
- **Last Updated:** 2026-10-25

---

## 0. Variables

Set these once. They are placeholders; nothing here is executed by the repository.

```bash
PROJECTS=/home/ck/Projects
PRIMARY="$PROJECTS/holoraa"                   # destination path (the primary working copy)
STAGING="$PROJECTS/holoraa-staging"           # verified v2 repository
ARCHIVE="$PROJECTS/holoraa-legacy-archive"    # where the legacy copy goes; never deleted
BACKUP_ROOT=/home/ck/backups                  # outside the projects tree
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$BACKUP_ROOT/holoraa-transition-$STAMP"
GO="$HOME/toolchains/go1.27.3/go/bin/go"
```

## 1. Preconditions

Each must hold before the backup is taken.

1. **Staging is committed and clean.** `git -C "$STAGING" status --porcelain` prints nothing.
2. **Staging checks pass on the tip being moved.** `make -C "$STAGING" check-all GO="$GO"` and `make -C "$STAGING" e2e GO="$GO"` exit 0 in the same session.
3. **The tip is recorded.** `git -C "$STAGING" rev-parse HEAD` is written into the backup manifest.
4. **Nothing is pushed.** Nothing in this procedure pushes, changes a remote, or touches GitHub `main`.
5. **Legacy containers are not touched.** The procedure does not stop, remove or inspect the volumes of `holoraa-postgres`, `holoraa-redis` or `akesis-postgres`. Before and after, record their container IDs (for example, `docker ps -a --no-trunc --format '{{.Names}} {{.ID}}'`) and confirm they are unchanged.

## 2. Backup (copy only; nothing is moved or deleted)

```bash
mkdir -p "$BACKUP"
chmod 700 "$BACKUP"

# Full copies of both repositories, including ignored files and the .env file.
tar -C "$PROJECTS" -czf "$BACKUP/holoraa-primary.tar.gz" holoraa
tar -C "$PROJECTS" -czf "$BACKUP/holoraa-staging.tar.gz" holoraa-staging

# Git bundles: a complete, separate copy of every ref in each repository.
git -C "$PRIMARY" bundle create "$BACKUP/holoraa-primary.bundle" --all
git -C "$STAGING" bundle create "$BACKUP/holoraa-staging.bundle" --all

# Record what was backed up.
{
  echo "staging HEAD: $(git -C "$STAGING" rev-parse HEAD)"
  echo "primary HEAD: $(git -C "$PRIMARY" rev-parse HEAD)"
  echo "created: $STAMP"
} > "$BACKUP/RECORD.txt"
(cd "$BACKUP" && sha256sum *.tar.gz *.bundle RECORD.txt > MANIFEST.sha256)

# The archives contain .env files with local credentials. Restrict them.
chmod 600 "$BACKUP"/*
```

## 3. Verification of the backup

The backup is not trusted until every check below passes.

```bash
cd "$BACKUP" && sha256sum -c MANIFEST.sha256                    # every line OK
tar -tzf holoraa-primary.tar.gz  > /dev/null && echo "primary archive reads"
tar -tzf holoraa-staging.tar.gz  > /dev/null && echo "staging archive reads"
git bundle verify holoraa-primary.bundle                         # "is okay"
git bundle verify holoraa-staging.bundle                         # "is okay"

# The bundle must contain the recorded tip.
git bundle list-heads holoraa-staging.bundle | grep -q "$(git -C "$STAGING" rev-parse HEAD)" && echo "staging tip present"

# A test restore into a temporary directory, never into the projects tree.
TMP=$(mktemp -d /tmp/holoraa-restore-test-XXXX)
tar -C "$TMP" -xzf "$BACKUP/holoraa-staging.tar.gz"
git -C "$TMP/holoraa-staging" status --porcelain | wc -l          # expect 0
rm -rf "$TMP"
```

Keep the backup directory until the new primary has passed its checks and the owner has confirmed the transition.

## 4. Move (requires approval; reversible)

```bash
# Confirm the staging tree has not changed since the backup.
test -z "$(git -C "$STAGING" status --porcelain)" && echo "staging clean"
test "$(git -C "$STAGING" rev-parse HEAD)" = "$(grep '^staging HEAD' "$BACKUP/RECORD.txt" | cut -d' ' -f3)" && echo "tip unchanged"

mv "$PRIMARY" "$ARCHIVE"
mv "$STAGING" "$PRIMARY"

# The v2-m0 worktree was registered by the legacy repository, using absolute paths.
# Repair the link after the move, then confirm.
git -C "$PRIMARY" worktree repair
git -C "$PRIMARY" worktree list
```

Note: `holoraa-v2-m0` is a worktree of the legacy repository. Its `.git` file points into the legacy directory. After the move it is repaired only if the owner approves that worktree staying. Otherwise it is left for the owner to remove by hand. This runbook does not remove it.

## 5. Verify the new primary

```bash
cd "$PRIMARY"
make check-all GO="$GO"
make e2e GO="$GO"
git status --porcelain | wc -l                                  # expect 0
```

Also check the legacy containers again (step 1.5). Their IDs must be unchanged.

## 6. Rollback

Rollback is two renames. It works until the owner removes the archive.

```bash
mv "$PRIMARY" "$STAGING"
mv "$ARCHIVE" "$PRIMARY"
git -C "$PRIMARY" worktree repair
```

After a rollback, re-run the checks in step 5 against the restored directory before continuing.

## 7. What this runbook never does

- Delete any directory, branch, tag, worktree, backup or volume.
- Push, tag, or change remote refs.
- Rewrite history.
- Touch legacy containers or their volumes.
- Rotate credentials.

Any of these needs a separate, explicit decision.
