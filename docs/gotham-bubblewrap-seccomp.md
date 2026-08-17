# Gotham Bubblewrap seccomp profile

`configs/seccomp/gotham-bwrap.json` is a derivative of Moby's Docker default
seccomp profile. It retains the default `SCMP_ACT_ERRNO` policy and adds one
allow rule for the syscalls Bubblewrap needs to create and enter its own
workspace sandbox:

`unshare`, `clone`, `clone3`, `mount`, `umount`, `umount2`, `pivot_root`,
`sethostname`, `setdomainname`, and `setns`.

The backend container still runs unprivileged with Docker's normal capability
set. Kernel permission checks therefore continue to deny these operations in
the initial container namespace, while Bubblewrap can use them only after it
creates its isolated user namespace.

The Compose backend service applies this profile with `security_opt`; it does
not use `privileged: true` or `seccomp=unconfined`. Revalidate this profile
after upgrading Docker or Codex with:

```sh
docker compose run --rm backend sh -lc 'codex sandbox /bin/true'
```

Docker documents that its normal seccomp profile blocks namespace-creation
syscalls and supports supplying a custom policy for a container. See
https://docs.docker.com/engine/security/seccomp/.
