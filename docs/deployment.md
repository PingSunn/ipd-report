# Production deployment

Production runs from GitHub Actions and Argo CD on the home k3s cluster. The
application image and the operations image are published as multi architecture
GHCR packages for `linux/amd64` and `linux/arm64`. The operations image runs
Prisma migrations in the Argo PreSync Job and the scheduled LINE worker in a
single replica.

## Infisical

Use the root `/` path in the `prod` environment of the Infisical project
`ipd-ye-g4`. Keep all values in Infisical; do not put them in Git or
Kubernetes manifests.

- `DATABASE_URL`: Supabase pooled connection URL for the application runtime.
- `BETTER_AUTH_SECRET`: random value with at least 32 characters.
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_BOOTSTRAP_EMAIL`: first ward-head Gmail address.
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `DIRECT_URL`: Supabase direct connection URL with schema migration privileges.

Use a restricted Supabase role in `DATABASE_URL`. Keep migration credentials in
`DIRECT_URL`, and require TLS on both connections. The Infisical operator
materializes one `ipd-report-env` Kubernetes Secret in the `ipd-report`
namespace, consumed by the web, worker, and migration Job.

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
3. In the GitOps repository, set the application source to this release commit
   SHA and sync `deploy/overlays/prod-secrets` first. Wait for the
   `InfisicalSecret` resource and its generated Kubernetes Secret to become
   Ready.
4. Set the application and operations image references in the Argo Application
   to the reviewed digests, then sync `deploy/overlays/prod`. The PreSync Job
   applies Prisma migrations before the web and worker Deployments start.
5. Add the proxied DNS record for `ipd.pskwr.com` to the existing Cloudflare
   Tunnel and route it to the cluster Traefik entry point. Confirm the
   `ipd-report-tls` certificate, `/api/live` liveness, and `/api/health`
   readiness before testing Google login and a census save.

The production overlay sets `BETTER_AUTH_URL` and
`BETTER_AUTH_TRUSTED_ORIGINS` to `https://ipd.pskwr.com`. The Google OAuth
client must allow `https://ipd.pskwr.com/api/auth/callback/google`.

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
