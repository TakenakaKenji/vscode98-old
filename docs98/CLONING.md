# Cloning this repo (read this before `git clone`)

This is a fork of microsoft/vscode, so the repository on GitHub holds upstream's whole history (~200,000 commits, ~1.5 GB packed) and thousands of upstream tags and branches. A plain `git clone` downloads all of it: a 2.3 GB folder (measured on 2026-11-23: `.git` 1.7 GB, plus about 0.6 GB of files). Nothing in `docs98/` or our own commits is large; the size is upstream's history. We do not need it.

## Clone like this (65 MB download, about 400 MB on disk)

```
sudo dnf install git-lfs        # or: apt install git-lfs / brew install git-lfs / winget install GitHub.GitLFS
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 50 --single-branch --no-tags \
  --branch claude/adoring-heisenberg-ipwnb8 \
  https://github.com/TakenakaKenji/vscode98 vscode98
cd vscode98
git lfs install --skip-smudge --local
git config remote.origin.tagOpt --no-tags
```

- `--depth 50 --single-branch --no-tags`: the last 50 commits of one branch, no tags. **Tags matter most:** a plain `git fetch` in a shallow clone also fetches the tags, and an old tag pulls in the full history behind it (this made a 69 MB clone grow to 1.7 GB within minutes on 2026-11-23). `--no-tags` plus `remote.origin.tagOpt` stops that.
- `GIT_LFS_SKIP_SMUDGE=1` and `git lfs install --skip-smudge --local`: upstream tracks about 98 test files under `extensions/copilot/test/simulation/cache/` with git-lfs (about 260 MB). We never need them; they stay as small pointer files. `git-lfs` must still be installed, or checkout fails with "git-lfs: command not found" (some machines have the lfs filter in their global git config).
- `main` points at the same commit as the working branch; fetch it only if needed: `git fetch origin main --depth 50`.

## Checks

```
git rev-parse --is-shallow-repository    # true
du -sh .git                              # about 70 MB
git for-each-ref | wc -l                 # a handful, not thousands
```

If `.git` grows past a few hundred MB, something fetched deep history (usually tags, or `git fetch --unshallow`): re-clone with the command above.

## Merging upstream later

`git remote add upstream https://github.com/microsoft/vscode`, then `git fetch upstream --depth=200 --no-tags main`; if a merge says it has no common ancestor, `git fetch --deepen=500 upstream main` and retry. Do this on purpose, in a clone you can throw away, not as a routine `git fetch`.

## Why we did not shrink the GitHub repository itself

Making the repo small means replacing its history with new commits, which cuts the link to upstream and loses the ability to merge upstream changes cleanly. It is a one-way decision for the owner to make; this document is the cheap fix.
