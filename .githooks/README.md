# Repository Git hooks

Enable the tracked hooks once per clone:

```sh
npm run git:hooks:install
```

The `pre-push` hook checks only objects selected for the push and rejects blobs
at or above GitHub's 100 MiB limit. It does not inspect working-tree files or
delete local observability data.
