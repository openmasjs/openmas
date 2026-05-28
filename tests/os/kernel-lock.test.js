import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  access,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import {
  assertOpenMasOsKernelLock,
  claimKernelLock,
  isKernelLockStale,
  readKernelLock,
  refreshKernelLock,
  releaseKernelLock,
} from '../../src/os/service/kernel-lock.js';

const NOW = '2026-05-17T11:00:00-05:00';
const LATER = '2026-05-17T11:00:10-05:00';
const MUCH_LATER = '2026-05-17T11:02:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-kernel-lock-'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

function resolveLockPath(projectRootPath) {
  return path.join(projectRootPath, 'instance', 'os', 'service', 'kernel-lock.json');
}

function resolveRecoveryGuardPath(projectRootPath) {
  return path.join(projectRootPath, 'instance', 'os', 'service', 'kernel-lock.json.recovery');
}

test('claimKernelLock lets the first OpenMAS OS service claim the singleton lock', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const claim = await claimKernelLock({
    projectRootPath,
    adapter,
    serviceId: 'openmas_os_service_alpha',
    staleAfterMs: 60000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });

  assert.equal(claim.status, 'claimed');
  assert.equal(claim.claimed, true);
  assert.equal(claim.lock.serviceId, 'openmas_os_service_alpha');
  assert.equal(claim.lock.pid, 101);
  assert.equal(claim.lock.hostname, 'test-host');
  assert.equal(claim.lock.claimedAt, NOW);
  assert.equal(claim.lock.refreshedAt, NOW);
  assert.equal(claim.lock.staleAfterMs, 60000);
  assert.equal(claim.lock.expiresAt, '2026-05-17T16:01:00.000Z');
  await assertFileExists(resolveLockPath(projectRootPath));
  assert.deepEqual(await readKernelLock({ projectRootPath }), claim.lock);

  const events = await adapter.readEvents({ date: '2026-05-17' });
  assert.deepEqual(
    events.map((event) => event.eventType),
    ['os.service.lock.claimed'],
  );
});

test('claimKernelLock rolls back a fresh lock when claim audit persistence fails', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const failingAdapter = {
    appendEvent: async () => {
      throw new Error('Injected lock claim audit failure.');
    },
  };

  await assert.rejects(
    () => claimKernelLock({
      projectRootPath,
      adapter: failingAdapter,
      serviceId: 'openmas_os_service_audit_failure',
      staleAfterMs: 60000,
      now: () => NOW,
      pid: 101,
      hostname: 'test-host',
    }),
    /Injected lock claim audit failure/u,
  );

  assert.equal(await readKernelLock({ projectRootPath }), null);
});

test('claimKernelLock refuses a second service while the existing lock is fresh', async () => {
  const projectRootPath = await createTemporaryProjectRoot();

  const firstClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alpha',
    staleAfterMs: 60000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });
  const secondClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_beta',
    staleAfterMs: 60000,
    now: () => LATER,
    pid: 202,
    hostname: 'other-host',
  });

  assert.equal(secondClaim.status, 'refused');
  assert.equal(secondClaim.claimed, false);
  assert.equal(secondClaim.reason, 'fresh_lock_exists');
  assert.equal(secondClaim.lock.serviceId, 'openmas_os_service_alpha');
  assert.equal(secondClaim.previousLock.lockId, firstClaim.lock.lockId);
  assert.equal(secondClaim.freshness.stale, false);
  assert.equal(secondClaim.freshness.ageMs, 10000);
  assert.deepEqual(await readKernelLock({ projectRootPath }), firstClaim.lock);
});

test('claimKernelLock recovers a stale lock and records the previous owner', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const firstClaim = await claimKernelLock({
    projectRootPath,
    adapter,
    serviceId: 'openmas_os_service_alpha',
    staleAfterMs: 1000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });
  const recoveredClaim = await claimKernelLock({
    projectRootPath,
    adapter,
    serviceId: 'openmas_os_service_beta',
    staleAfterMs: 1000,
    now: () => MUCH_LATER,
    pid: 202,
    hostname: 'other-host',
  });

  assert.equal(recoveredClaim.status, 'recovered');
  assert.equal(recoveredClaim.claimed, true);
  assert.equal(recoveredClaim.reason, 'stale_lock_recovered');
  assert.equal(recoveredClaim.previousLock.lockId, firstClaim.lock.lockId);
  assert.equal(recoveredClaim.lock.serviceId, 'openmas_os_service_beta');
  assert.equal(recoveredClaim.lock.recoveredFromLockId, firstClaim.lock.lockId);
  assert.equal(recoveredClaim.lock.recoveredAt, MUCH_LATER);
  assert.equal(recoveredClaim.freshness.stale, true);
  assert.deepEqual(await readKernelLock({ projectRootPath }), recoveredClaim.lock);

  const events = await adapter.readEvents({ date: '2026-05-17' });
  assert.deepEqual(
    events.map((event) => event.eventType),
    [
      'os.service.lock.claimed',
      'os.service.lock.recovered',
    ],
  );
});

test('claimKernelLock rolls back a recovered lock when recovery audit persistence fails', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const failingAdapter = {
    appendEvent: async () => {
      throw new Error('Injected lock recovery audit failure.');
    },
  };

  await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_stale_owner',
    staleAfterMs: 1000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
    audit: false,
  });

  await assert.rejects(
    () => claimKernelLock({
      projectRootPath,
      adapter: failingAdapter,
      serviceId: 'openmas_os_service_recovery_audit_failure',
      staleAfterMs: 60000,
      now: () => MUCH_LATER,
      pid: 202,
      hostname: 'other-host',
    }),
    /Injected lock recovery audit failure/u,
  );

  assert.equal(await readKernelLock({ projectRootPath }), null);
});

test('claimKernelLock safely serializes concurrent stale lock recovery contenders', async () => {
  const projectRootPath = await createTemporaryProjectRoot();

  await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_stale_owner',
    staleAfterMs: 1000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });

  const attempts = await Promise.all(Array.from({ length: 32 }, (_, index) => {
    return claimKernelLock({
      projectRootPath,
      serviceId: `openmas_os_service_recovery_${index}`,
      staleAfterMs: 60000,
      now: () => MUCH_LATER,
      pid: 200 + index,
      hostname: 'other-host',
    });
  }));
  const recovered = attempts.filter((attempt) => attempt.status === 'recovered');
  const refused = attempts.filter((attempt) => attempt.status === 'refused');
  const finalLock = await readKernelLock({ projectRootPath });

  assert.equal(recovered.length, 1);
  assert.equal(refused.length, 31);
  assert.equal(finalLock.serviceId, recovered[0].lock.serviceId);
  assert.ok(refused.every((attempt) => {
    return [
      'fresh_lock_exists',
      'stale_lock_recovery_in_progress',
      'lock_changed_during_recovery',
    ].includes(attempt.reason);
  }));
});

test('claimKernelLock recovers after a stale orphaned recovery guard', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const staleClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_crashed_owner',
    staleAfterMs: 1000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });

  await writeFile(
    resolveRecoveryGuardPath(projectRootPath),
    `${JSON.stringify({
      kind: 'openmas_os_kernel_lock_recovery_guard',
      version: 1,
      recoveryId: 'kernel_lock_recovery_orphaned',
      lockId: staleClaim.lock.lockId,
      serviceId: 'openmas_os_service_crashed_recovery',
      startedAt: NOW,
    }, null, 2)}\n`,
    'utf8',
  );

  const recoveredClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_healthy_recovery',
    staleAfterMs: 1000,
    now: () => MUCH_LATER,
    pid: 202,
    hostname: 'other-host',
  });

  assert.equal(recoveredClaim.status, 'recovered');
  assert.equal(recoveredClaim.lock.serviceId, 'openmas_os_service_healthy_recovery');
  assert.equal((await readKernelLock({ projectRootPath })).lockId, recoveredClaim.lock.lockId);
  await assert.rejects(() => access(resolveRecoveryGuardPath(projectRootPath)), { code: 'ENOENT' });
});

test('refreshKernelLock updates only the owning service lock', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const claim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alpha',
    staleAfterMs: 60000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });

  const refusedRefresh = await refreshKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_beta',
    lockId: claim.lock.lockId,
    now: () => LATER,
  });
  const refresh = await refreshKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alpha',
    lockId: claim.lock.lockId,
    now: () => LATER,
  });

  assert.equal(refusedRefresh.status, 'refused');
  assert.equal(refusedRefresh.refreshed, false);
  assert.equal(refusedRefresh.reason, 'lock_owned_by_another_service');
  assert.equal(refresh.status, 'refreshed');
  assert.equal(refresh.refreshed, true);
  assert.equal(refresh.lock.lockId, claim.lock.lockId);
  assert.equal(refresh.lock.refreshedAt, LATER);
  assert.equal(refresh.lock.refreshCount, 1);
  assert.equal(refresh.lock.expiresAt, '2026-05-17T16:01:10.000Z');
  assert.deepEqual(await readKernelLock({ projectRootPath }), refresh.lock);
});

test('releaseKernelLock removes the owner lock so another service can start', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const claim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alpha',
    staleAfterMs: 60000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });

  const ignoredRelease = await releaseKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_beta',
    lockId: claim.lock.lockId,
    now: () => LATER,
  });
  const release = await releaseKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alpha',
    lockId: claim.lock.lockId,
    now: () => LATER,
  });
  const nextClaim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_beta',
    staleAfterMs: 60000,
    now: () => MUCH_LATER,
    pid: 202,
    hostname: 'other-host',
  });

  assert.equal(ignoredRelease.status, 'ignored');
  assert.equal(ignoredRelease.released, false);
  assert.equal(release.status, 'released');
  assert.equal(release.released, true);
  assert.equal(nextClaim.status, 'claimed');
  assert.equal(nextClaim.lock.serviceId, 'openmas_os_service_beta');
});

test('kernel lock freshness uses heartbeat freshness and lock state stays secret-safe', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const claim = await claimKernelLock({
    projectRootPath,
    serviceId: 'openmas_os_service_alpha',
    staleAfterMs: 1000,
    now: () => NOW,
    pid: 101,
    hostname: 'test-host',
  });
  const lockFileContent = await readFile(resolveLockPath(projectRootPath), 'utf8');

  assert.deepEqual(isKernelLockStale({
    lock: claim.lock,
    now: () => LATER,
  }), {
    stale: true,
    ageMs: 10000,
    expiresAt: claim.lock.expiresAt,
  });
  assert.doesNotMatch(lockFileContent, /sk-or-v1/u);
  assert.doesNotMatch(lockFileContent, /AIza/u);
  assertOpenMasOsKernelLock(claim.lock);

  await assert.rejects(
    () => claimKernelLock({
      projectRootPath,
      serviceId: 'openmas_os_service_sk-or-v1-secret123456789',
      staleAfterMs: 1000,
      now: () => NOW,
      pid: 101,
      hostname: 'test-host',
    }),
    /unsafe characters|secret-like value/u,
  );
});
