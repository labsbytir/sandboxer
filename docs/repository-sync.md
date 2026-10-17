# Repository sync

Sandboxer has two repositories:

- Private development: https://github.com/pennytir/sandboxer
- Public copy: https://github.com/labsbytir/sandboxer

After committing changes, run `npm run sync:repos` to push your local `main`
and `staging` branches to both repositories. Preview with
`npm run sync:repos -- --dry-run`. Git authentication needs write access to both.

This is an explicit publishing command, not an automatic background sync.
Everything committed to these branches becomes public, including their history.
Uncommitted files, other branches, issues, settings and secrets are not copied.
Each repository update is atomic; updates across both repositories are not.
If one push fails, resolve the error and rerun the command. Diverging remote
history is rejected rather than overwritten; fetch and reconcile it first.

Public visibility does not grant an open-source license. The package remains
UNLICENSED until a license is selected.
