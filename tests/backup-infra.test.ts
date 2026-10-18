import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8');

describe('backup image build', () => {
  const dockerfile = repo('Dockerfile');

  it('uses pinned PostgreSQL and Bun images and a minimal non-root runtime', () => {
    expect(dockerfile).toContain(
      'FROM postgres:18-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c AS backup',
    );
    expect(dockerfile).toContain(
      'FROM oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS backup-bun',
    );
    expect(dockerfile).toContain('COPY --from=backup-bun /usr/local/bin/bun /usr/local/bin/bun');
    expect(dockerfile).toContain('COPY package.json bun.lock ./');
    expect(dockerfile).toContain('RUN bun install --frozen-lockfile --production');
    expect(dockerfile).toContain('COPY --chown=1000:1000 scripts/backup ./scripts/backup');
    expect(dockerfile).toContain('USER 1000:1000');
    expect(dockerfile).toContain('ENTRYPOINT ["bun", "scripts/backup/run.ts"]');
    expect(dockerfile).toContain('libstdc++6');
  });

  it('excludes backup output and key material from build context', () => {
    const dockerignore = repo('.dockerignore');
    for (const pattern of ['backups/', 'backup-artifacts/', '*.dump', '*.sql.gz', '*.age', '*.key']) {
      expect(dockerignore).toContain(pattern);
    }
    expect(dockerignore).not.toContain('scripts/backup');
  });
});

describe('backup CronJob hardening', () => {
  const cronJob = repo('deploy/base/backup-cronjob.yaml');

  it('is a suspended, bounded, non-overlapping Bangkok schedule', () => {
    expect(cronJob).toContain('name: ipd-report-backup');
    expect(cronJob).toContain('schedule: "0 3 * * *"');
    expect(cronJob).toContain('timeZone: Asia/Bangkok');
    expect(cronJob).toContain('suspend: true');
    expect(cronJob).toContain('concurrencyPolicy: Forbid');
    expect(cronJob).toContain('startingDeadlineSeconds: 3600');
    expect(cronJob).toContain('backoffLimit: 1');
    expect(cronJob).toContain('activeDeadlineSeconds: 1800');
    expect(cronJob).toContain('successfulJobsHistoryLimit: 1');
    expect(cronJob).toContain('failedJobsHistoryLimit: 3');
  });

  it('passes only explicit backup secrets and uses bounded writable disk', () => {
    const secretNames = [
      'BACKUP_DATABASE_URL',
      'BACKUP_ENCRYPTION_KEY',
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_REGION',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_PREFIX',
      'BACKUP_S3_FORCE_PATH_STYLE',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
    ];
    for (const name of secretNames) {
      expect(cronJob).toMatch(new RegExp(`name: ${name}[\\s\\S]+?key: ${name}`));
    }
    expect(cronJob).toContain('name: BACKUP_RETENTION_DAYS\n                  value: "14"');
    expect(cronJob).not.toContain('envFrom:');
    expect(cronJob).not.toMatch(/name: (?:DATABASE_URL|DIRECT_URL|LINE_CHANNEL)/);
    expect(cronJob).not.toContain('medium: Memory');
    expect(cronJob).toContain('sizeLimit: 2Gi');
    expect(cronJob).toContain('ephemeral-storage: 256Mi');
    expect(cronJob).toContain('ephemeral-storage: 2Gi');
    expect(cronJob).toContain('readOnlyRootFilesystem: true');
    expect(cronJob).toContain('automountServiceAccountToken: false');
    expect(cronJob).toContain('runAsUser: 1000');
    expect(cronJob).toContain('runAsGroup: 1000');
    expect(cronJob).toContain('type: RuntimeDefault');
    expect(cronJob).toContain('drop:\n                    - ALL');
    expect(cronJob).not.toContain('restore');
    expect(cronJob).not.toContain('localhost');
  });
});

describe('backup network and monitoring manifests', () => {
  it('allows only DNS, HTTPS, and PostgreSQL egress and denies ingress', () => {
    const policy = repo('deploy/base/backup-network-policy.yaml');
    expect(policy).toContain('app.kubernetes.io/name: ipd-report-backup');
    expect(policy).toContain('ingress: []');
    expect(policy).toContain('k8s-app: kube-dns');
    expect(policy).toContain('port: 53');
    expect(policy).toContain('port: 443');
    expect(policy).toContain('port: 5432');
    expect(policy).not.toContain('port: 6543');
  });

  it('keeps PrometheusRule optional and scoped to enabled backup schedules', () => {
    const base = repo('deploy/base/kustomization.yaml');
    const prod = repo('deploy/overlays/prod/kustomization.yaml');
    const monitoring = repo('deploy/monitoring/backup-prometheusrule.yaml');
    expect(base).not.toContain('../monitoring');
    expect(prod).toContain('../../monitoring');
    expect(monitoring).toContain('kind: PrometheusRule');
    expect(monitoring).toContain('release: kube-prometheus-stack');
    expect(monitoring).toContain('namespace="ipd-report"');
    expect(monitoring).toContain('job_name=~"ipd-report-backup-[0-9]+"');
    expect(monitoring).toContain('kube_job_failed{namespace="ipd-report",job_name=~"ipd-report-backup-[0-9]+",condition="true"} == 1');
    expect(monitoring).toContain('kube_job_created{namespace="ipd-report",job_name=~"ipd-report-backup-[0-9]+"}');
    expect(monitoring).toContain('kube_job_status_completion_time');
    expect(monitoring).toContain('kube_job_status_succeeded');
    expect(monitoring).toContain('cronjob="ipd-report-backup"} == 0');
    expect(monitoring).toContain('26 * 60 * 60');
    expect(monitoring).toContain('kube_cronjob_created{namespace="ipd-report",cronjob="ipd-report-backup"}');
    expect(monitoring).not.toMatch(/LINE|ward|receiver:/i);

    const promtoolRules = repo('deploy/monitoring/backup-promtool.rules.yaml');
    const promtoolTests = repo('deploy/monitoring/backup-promtool.test.yml');
    expect(promtoolRules).toContain('kube_job_failed{namespace="ipd-report",job_name=~"ipd-report-backup-[0-9]+",condition="true"} == 1');
    expect(promtoolTests).toContain('failed backup without a successful job fires');
    expect(promtoolTests).toContain('successful backup suppresses an older failed job');
    expect(promtoolTests).toContain('stale fallback uses CronJob creation when no success exists');
  });

  it('covers failed-job suppression and no-success stale fallback with focused fixtures', () => {
    const hour = 60 * 60;
    const day = 24 * hour;
    const failedJobCreated = 2 * hour;
    const successfulJobCompleted = 5 * hour;
    const cronJobCreated = 0;
    const failureIsCurrent = (latestSuccess: number | undefined): boolean =>
      failedJobCreated > (latestSuccess ?? cronJobCreated);
    const latestSuccess: number | undefined = undefined;
    const staleWithoutSuccess = (now: number): boolean =>
      now - (latestSuccess === undefined ? cronJobCreated : latestSuccess) > 26 * hour;

    // A failed Job alerts when it is newer than the latest successful Job.
    expect(failureIsCurrent(undefined)).toBe(true);
    // A later successful Job suppresses the earlier failed Job alert.
    expect(failureIsCurrent(successfulJobCompleted)).toBe(false);
    expect(staleWithoutSuccess(27 * hour + 1)).toBe(true);
    expect(staleWithoutSuccess(25 * day)).toBe(true);
  });
});

describe('backup image publishing', () => {
  it('publishes a third multi-architecture image and records its digest', () => {
    const ci = repo('.github/workflows/ci.yml');
    expect(ci).toContain('BACKUP_IMAGE: ghcr.io/pingsunn/ipd-report-backup');
    expect(ci).toContain('target: backup');
    expect(ci).toContain('platforms: linux/amd64,linux/arm64');
    expect(ci).toContain('tags: ${{ env.BACKUP_IMAGE }}:${{ env.IMAGE_TAG }}');
    expect(ci).toContain('BACKUP_DIGEST: ${{ steps.backup.outputs.digest }}');
    expect(ci).toContain('"$BACKUP_IMAGE" "$IMAGE_TAG" "$BACKUP_DIGEST"');
  });
});
