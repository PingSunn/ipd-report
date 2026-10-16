# Production deployment

Production runs from GitHub Actions and Argo CD on the home k3s cluster. The
application image and the operations image are published as multi architecture
GHCR packages for `linux/amd64` and `linux/arm64`. The operations image runs
Prisma migrations in the Argo PreSync Job and the scheduled LINE worker in a
single replica.

Prisma CLI is pinned to the current 7.10.1 patch release and is included only
in the operations image because the migration hook invokes it. The web image
uses Next.js standalone output and does not copy the CLI or its development
transitive packages into the runtime filesystem.

## Infisical

Use the root `/` path in the `prod` environment of the Infisical project
`ipd-ye-g4`. Keep all values in Infisical; do not put them in Git or
Kubernetes manifests.

- `DATABASE_URL`: Supabase pooled connection URL for the application runtime.
- `BETTER_AUTH_SECRET`: random value with at least 32 characters.
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_BOOTSTRAP_EMAIL`: explicit initial ward-head Gmail address; production has no fallback and cannot bootstrap an empty database when omitted.
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`: worker-only secret; do not mount it into the web pod.
- `DIRECT_URL`: Supabase direct connection URL with schema migration privileges.

Use the provisioned restricted `ipd_app` role in `DATABASE_URL`. Keep migration
credentials in `DIRECT_URL`, and require TLS on both connections. The Infisical
operator materializes one `ipd-report-env` Kubernetes Secret in the
`ipd-report` namespace. The web Deployment consumes only the pooled runtime
URL, Google credentials, the webhook secret, and the non-secret LINE readiness
indicator (set in the Deployment overlay). The worker consumes the pooled runtime URL and LINE access token;
the migration Job consumes only `DIRECT_URL`.

## Release flow

1. Merge the reviewed application release to `main`. The `verify` job installs
   with the frozen Bun lockfile, applies migrations to a disposable PostgreSQL
   service, runs type checks and tests, and builds Next.js.
2. The `publish` job builds and pushes these immutable image tags:

   - `ghcr.io/pingsunn/ipd-report:sha-<commit>`
   - `ghcr.io/pingsunn/ipd-report-ops:sha-<commit>`

   Record the multi architecture digests from the workflow summary. Set both
   GHCR packages to Public before the cluster rollout if the cluster has no
   image pull secret for GHCR.
3. Before the first runtime-role cutover, apply migrations with `DIRECT_URL`,
   run `bun run db:provision-runtime-role`, verify the `ipd_app` grants, and
   then set `DATABASE_URL` to the pooled `ipd_app` connection. Keep
   `DIRECT_URL` owner-only for later migration Jobs.
4. In the GitOps repository, set the application source to this release commit
   SHA and sync `deploy/overlays/prod-secrets` first. Wait for the
   `InfisicalSecret` resource and its generated Kubernetes Secret to become
   Ready.
5. Set the application and operations image references in the Argo Application
   to the reviewed digests, then sync `deploy/overlays/prod`. The PreSync Job
   applies Prisma migrations before the web and worker Deployments start.
6. Add the proxied DNS record for `ipd.pskwr.com` to the existing Cloudflare
   Tunnel and route it to the cluster Traefik entry point. Confirm the
   `ipd-report-tls` certificate, `/api/live` liveness, and `/api/health`
   readiness before testing Google login and a census save.

The production overlay sets `BETTER_AUTH_URL` and
`BETTER_AUTH_TRUSTED_ORIGINS` to `https://ipd.pskwr.com`. The Google OAuth
client must allow `https://ipd.pskwr.com/api/auth/callback/google`.

Both workloads run as non-root with the RuntimeDefault seccomp profile, drop
all Linux capabilities, disable privilege escalation, and use a read-only root
filesystem with a memory-backed `/tmp`. Service-account token automounting is
disabled. The NetworkPolicies allow cluster DNS plus TCP 443 for Google/LINE
and TCP 5432/6543 for Supabase direct and transaction-pooler connections;
update the egress CIDRs if a stable provider range becomes available.

## Checks

Use the cluster kubeconfig for read-only rollout checks. Never print Secret
data.

```sh
KUBECONFIG=~/.kube/hp01.yaml kubectl get infisicalsecret -n ipd-report
KUBECONFIG=~/.kube/hp01.yaml kubectl get pods,job,ingress -n ipd-report
KUBECONFIG=~/.kube/hp01.yaml kubectl rollout status deployment/ipd-report -n ipd-report
KUBECONFIG=~/.kube/hp01.yaml kubectl rollout status deployment/ipd-report-worker -n ipd-report
```

The initial database is expected to be empty. Confirm that before the first
production migration. Later rollbacks must pin the previous application and
operations digests; reverting an image does not reverse database migrations.
