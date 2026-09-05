# Gotham Bubblewrap seccomp profile

`configs/seccomp/gotham-bwrap.json` is a derivative of Moby's Docker default
seccomp profile. It retains the default `SCMP_ACT_ERRNO` policy and adds one
allow rule for the syscalls Bubblewrap needs to create and enter its own
workspace sandbox:

`unshare`, `clone`, `clone3`, `mount`, `umount`, `umount2`, `pivot_root`,
`sethostname`, `setdomainname`, and `setns`.

The base development container runs without `privileged`, `CAP_SYS_ADMIN`, host
PID mode, or an unconfined seccomp profile. Kernel capability checks therefore
continue to deny these operations in the initial container namespace, while
Bubblewrap can use them only after it creates its isolated user namespace.

Ubuntu production hosts add `CAP_SYS_ADMIN` and `apparmor=unconfined` to the
backend container only. Ubuntu 24.04 and later can deny the capabilities that
Bubblewrap needs inside an unprivileged user namespace; Docker's default
AppArmor policy can also deny the mount-propagation setup. Without the scoped
production exception, Codex exits before a model call with
`bwrap: Failed to make / slave: Permission denied`. The container is not
privileged and retains its private PID/network namespaces,
`no-new-privileges=true`, and this checked-in seccomp allowlist.

The backend image selects the Bubblewrap helper bundled with the pinned Codex
CLI and verifies that it supports `--argv0`. Debian 12's Bubblewrap 0.8 does not
support that flag; using it can make Codex's inner `codex-linux-sandbox` helper
disappear at command start and surface a misleading `ENOENT` even though the
project mount is healthy.

Codex creates lock-protected command aliases below `CODEX_HOME/tmp/arg0` for
`codex-linux-sandbox` and `apply_patch`. Compose overlays that `tmp` directory
with the `plutomix-gotham-codex-runtime-v1` native Linux volume while retaining
the user's host-mounted Codex configuration and authentication above it. This
keeps concurrent janitor/lock operations off the host bind mount, where a live
alias directory could otherwise be removed and poison an active workflow.

Docker also masks or makes parts of `/proc` read-only by default. That prevents
nested Bubblewrap from mounting the private procfs required by Codex and
produces `bwrap: Can't mount proc on /proc: Operation not permitted`, even when
the required syscalls are present in seccomp. The Compose backend therefore
adds `systempaths=unconfined` for this container and compensates with
`no-new-privileges=true`. The backend retains its container PID namespace and
the checked-in seccomp allowlist; production adds only the compatibility
controls described above.

Do not replace these controls with `privileged: true`, host PID mode, or
`seccomp=unconfined`. Do not add `CAP_SYS_ADMIN` to the development service; its
production-only use is the bounded compatibility exception described above.
Revalidate the complete boundary after upgrading Docker or Codex against an
actual mounted project workspace with:

```sh
docker exec -w /workspace/apps/<project> plutomix-backend \
  codex --disable unified_exec sandbox -c 'sandbox_mode="workspace-write"' \
  /bin/sh -lc 'set -eu; probe=.plutomix-sandbox-preflight-$$; trap '\''rm -f "$probe"'\'' EXIT; test -r .; : > "$probe"; test -w "$probe"'
```

The expected result is exit code `0`, no Bubblewrap diagnostic, and no leftover
probe file. This verifies command startup plus read/write access inside the
selected mount; `/bin/true` alone is not a sufficient workspace health check.
`scripts/deploy-plutomix.sh` runs the equivalent no-model probe after starting
the production backend and fails the deployment if the sandbox is unavailable.
Confirm the effective runtime controls separately:

```sh
docker inspect -f 'security_opt={{json .HostConfig.SecurityOpt}} masked_paths={{json .HostConfig.MaskedPaths}} readonly_paths={{json .HostConfig.ReadonlyPaths}} cap_add={{json .HostConfig.CapAdd}} privileged={{.HostConfig.Privileged}} pid={{.HostConfig.PidMode}}' plutomix-backend
```

Docker documents that its normal seccomp profile blocks namespace-creation
syscalls and supports supplying a custom policy for a container. See
https://docs.docker.com/engine/security/seccomp/.

Docker documents `systempaths=unconfined` as turning off the masked/read-only
system-path confinement for one container. See
https://docs.docker.com/reference/cli/docker/container/run/#optional-security-options.
