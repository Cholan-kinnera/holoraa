# Contributing to Holoraa

Holoraa is in early foundation work. The rules are in [AGENTS.md](AGENTS.md). This page explains how to apply them day to day.

## Before you start

- Read [AGENTS.md](AGENTS.md). It is the authority for architecture, scope, and security.
- Check the active milestone in [docs/MILESTONE_GATES.md](docs/MILESTONE_GATES.md). Work outside it is out of scope.
- Features on the out-of-scope list in AGENTS.md (authentication, messaging, calls, feeds, and others) need an owner-approved design first.

## Branches and commits

- Work on a feature branch. Never commit to the default branch.
- One logical change per commit.
- Use Conventional Commits, for example `feat(backend): ...`, `docs(security): ...`, or `chore: ...`.
- Stage explicit paths. Do not use `git add .` or `git add -A`.
- Before each commit, run `git diff --check`, read `git diff`, and check `git status`.
- Never commit secrets, local databases, build output, or unrelated changes.

## Checks

From the repository root:

```bash
make check
```

This runs the Go formatting, static analysis, tests with the race detector, and the build. It needs Go 1.27.3. If that version is not on your PATH, pass its location:

```bash
make check GO=/path/to/go1.27.3/bin/go
```

Web and contract checks are added at milestones M4 and M5. See [docs/engineering/TESTING.md](docs/engineering/TESTING.md).

## Pull requests

- Use the pull request template.
- Describe what changed and how you checked it. Paste the real command output.
- Do not claim a check passed unless it ran.
- A change that touches authentication, user data, permissions, or security documents is flagged for owner review.

## Decisions

- Significant technical choices are recorded as ADRs in [docs/adr/](docs/adr/README.md). Only the owner sets an ADR's status.
- Unknown facts are marked `TODO(owner): ...`. Do not invent them.

## Security

Do not report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
