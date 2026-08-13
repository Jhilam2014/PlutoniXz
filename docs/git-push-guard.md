# Git push-size guard

GitHub rejects individual files at or above 100 MiB. This repository keeps
rolling observability timelines ignored, including
`observability/orchestrator-health/*.timeline.jsonl`, so they remain local.

Enable the repository-managed pre-push hook once per clone:

```sh
npm run git:hooks:install
```

Validate the currently committed tree at any time:

```sh
npm run git:verify-tree-size
```

The hook reads Git objects selected for a push. It neither rewrites history nor
removes local files. If it reports an oversized blob, remove it from the commit
before pushing or store the file with Git LFS.
