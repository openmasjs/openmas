import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import {
  OPENMAS_OS_SYSTEM_CALL_KINDS,
} from '../../src/contracts/openmas-os-system-call-contract.js';
import {
  createLocalSystemCallInbox,
} from '../../src/os/system-calls/local-system-call-inbox.js';

const NOW = '2026-05-19T10:00:00-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-system-call-inbox-'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

async function assertFileMissing(filePath) {
  await assert.rejects(
    () => access(filePath),
    { code: 'ENOENT' },
  );
}

function createSystemCall(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.systemCall,
    schemaVersion: 1,
    systemCallId: 'syscall_delegate_001',
    operation: 'delegate',
    status: 'pending',
    requestedAt: NOW,
    requestedBy: {
      type: 'operational_identity',
      operationalIdentityId: 'alfred',
    },
    correlation: {
      invocationId: 'agent-invocation-001',
      toolRunId: 'tool-run-001',
      conversationId: 'alfred-admin',
    },
    idempotencyKey: 'delegate:alfred:bruce:001',
    expiresAt: '2026-05-19T10:10:00-05:00',
    payload: {
      requesterOperationalIdentityId: 'alfred',
      targetOperationalIdentityId: 'bruce',
      child: {
        input: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    },
    ...overrides,
  };
}

function createSystemCallResult(overrides = {}) {
  return {
    kind: OPENMAS_OS_SYSTEM_CALL_KINDS.result,
    schemaVersion: 1,
    systemCallId: 'syscall_delegate_001',
    operation: 'delegate',
    status: 'completed',
    processedAt: '2026-05-19T10:00:01-05:00',
    processedBy: {
      serviceId: 'openmas_os_service_local',
      tickId: 'os_service_tick_001',
    },
    decision: {
      allowed: true,
      reason: 'Delegation policy allows Alfred to delegate ask work to Bruce.',
    },
    effects: {
      createdJobIds: [
        'job_bruce_child_001',
      ],
      createdTimerIds: [],
      createdSignalIds: [],
      createdProcessIds: [],
      createdThreadIds: [],
      eventIds: [
        'event_system_call_completed_001',
      ],
    },
    summary: 'OpenMAS OS created a child job for Bruce.',
    correlation: {
      invocationId: 'agent-invocation-001',
    },
    evidenceRefs: [],
    warnings: [],
    details: {
      childJobId: 'job_bruce_child_001',
    },
    ...overrides,
  };
}

test('LocalSystemCallInbox initializes the local JSON syscall layout without kernel state folders', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  const layout = await inbox.initialize();

  assert.equal(layout.osRootPath, path.join(projectRootPath, 'instance', 'os'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'completed'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'denied'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'failed'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'expired'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'cancelled'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'results'));
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'jobs'));
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'timers'));
});

test('LocalSystemCallInbox submits a pending system call append-only and loads it back', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  const submission = await inbox.submitSystemCall(createSystemCall({
    systemCallId: ' syscall_delegate_001 ',
  }));

  assert.equal(submission.systemCall.systemCallId, 'syscall_delegate_001');
  assert.equal(submission.state, 'pending');
  assert.equal(
    submission.systemCallPath,
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending', 'syscall_delegate_001.json'),
  );

  const loadedSystemCall = await inbox.loadPendingSystemCall('syscall_delegate_001');

  assert.deepEqual(loadedSystemCall, submission.systemCall);
  assert.deepEqual(
    JSON.parse(await readFile(submission.systemCallPath, 'utf8')),
    submission.systemCall,
  );
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'jobs'));
  await assertFileMissing(path.join(projectRootPath, 'instance', 'os', 'timers'));
});

test('LocalSystemCallInbox refuses duplicates and non-pending submissions', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await inbox.submitSystemCall(createSystemCall());

  await assert.rejects(
    () => inbox.submitSystemCall(createSystemCall()),
    /already exists/u,
  );

  await assert.rejects(
    () => inbox.submitSystemCall(createSystemCall({
      systemCallId: 'syscall_processing_001',
      status: 'processing',
    })),
    /only accepts pending/u,
  );
});

test('LocalSystemCallInbox updates parseable snapshot status when moving between states', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await inbox.submitSystemCall(createSystemCall());
  await inbox.moveSystemCall({
    systemCallId: 'syscall_delegate_001',
    fromState: 'pending',
    toState: 'processing',
  });

  const processingSnapshot = JSON.parse(await readFile(
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'processing', 'syscall_delegate_001.json'),
    'utf8',
  ));

  assert.equal(processingSnapshot.status, 'processing');

  await inbox.moveSystemCall({
    systemCallId: 'syscall_delegate_001',
    fromState: 'processing',
    toState: 'completed',
  });

  const completedSnapshot = JSON.parse(await readFile(
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'completed', 'syscall_delegate_001.json'),
    'utf8',
  ));

  assert.equal(completedSnapshot.status, 'completed');
});

test('LocalSystemCallInbox rejects unsafe pending calls before publication', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await assert.rejects(
    () => inbox.submitSystemCall(createSystemCall({
      payload: {
        requesterOperationalIdentityId: 'alfred',
        targetOperationalIdentityId: 'bruce',
        child: {
          input: 'Use sk-or-v1-secretvalue1234567890 while inspecting.',
        },
      },
    })),
    /secret-like value/u,
  );

  await assertFileMissing(path.join(
    projectRootPath,
    'instance',
    'os',
    'system-calls',
    'pending',
    'syscall_delegate_001.json',
  ));
});

test('LocalSystemCallInbox lists pending calls deterministically and ignores temporary files', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_b_later',
    requestedAt: '2026-05-19T10:02:00-05:00',
    idempotencyKey: 'delegate:alfred:bruce:b',
  }));
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_a_earlier',
    requestedAt: '2026-05-19T10:01:00-05:00',
    idempotencyKey: 'delegate:alfred:bruce:a',
  }));
  await inbox.submitSystemCall(createSystemCall({
    systemCallId: 'syscall_c_other_operation',
    operation: 'inspect_status',
    requestedAt: '2026-05-19T10:03:00-05:00',
    idempotencyKey: null,
    payload: {
      scope: 'service',
    },
  }));

  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending', '.syscall_temp.json'),
    JSON.stringify(createSystemCall({ systemCallId: 'syscall_hidden_temp' }), null, 2),
    'utf8',
  );

  const pendingSystemCalls = await inbox.listPendingSystemCalls();

  assert.deepEqual(
    pendingSystemCalls.map((systemCall) => systemCall.systemCallId),
    [
      'syscall_a_earlier',
      'syscall_b_later',
      'syscall_c_other_operation',
    ],
  );

  const delegateSystemCalls = await inbox.listPendingSystemCalls({ operation: 'delegate' });

  assert.deepEqual(
    delegateSystemCalls.map((systemCall) => systemCall.systemCallId),
    [
      'syscall_a_earlier',
      'syscall_b_later',
    ],
  );
});

test('LocalSystemCallInbox persists and reads result records without modifying pending calls', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await inbox.submitSystemCall(createSystemCall());

  assert.equal(await inbox.hasSystemCallResult('syscall_delegate_001'), false);

  const persisted = await inbox.persistSystemCallResult(createSystemCallResult());

  assert.equal(await inbox.hasSystemCallResult('syscall_delegate_001'), true);
  assert.equal(
    persisted.resultPath,
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'results', 'syscall_delegate_001.result.json'),
  );
  assert.deepEqual(await inbox.loadSystemCallResult('syscall_delegate_001'), persisted.result);

  const pending = await inbox.listPendingSystemCalls();
  assert.deepEqual(
    pending.map((systemCall) => systemCall.systemCallId),
    [
      'syscall_delegate_001',
    ],
  );

  const results = await inbox.listSystemCallResults();
  assert.deepEqual(
    results.map((result) => result.systemCallId),
    [
      'syscall_delegate_001',
    ],
  );
});

test('LocalSystemCallInbox refuses duplicate result records and unsafe result data', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await inbox.persistSystemCallResult(createSystemCallResult());

  await assert.rejects(
    () => inbox.persistSystemCallResult(createSystemCallResult()),
    /already exists/u,
  );

  await assert.rejects(
    () => inbox.persistSystemCallResult(createSystemCallResult({
      systemCallId: 'syscall_bad_result_001',
      details: {
        accessToken: 'Bearer verysecretaccesstoken',
      },
    })),
    /raw secret-like field/u,
  );
});

test('LocalSystemCallInbox reports invalid persisted JSON clearly', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await mkdir(path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'system-calls', 'pending', 'syscall_broken.json'),
    '{',
    'utf8',
  );

  await assert.rejects(
    () => inbox.loadPendingSystemCall('syscall_broken'),
    /could not be parsed as JSON/u,
  );
});

test('LocalSystemCallInbox does not leave temporary publication files behind', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const inbox = createLocalSystemCallInbox({ projectRootPath });

  await inbox.submitSystemCall(createSystemCall());

  const pendingDirectoryEntries = await readdir(path.join(
    projectRootPath,
    'instance',
    'os',
    'system-calls',
    'pending',
  ));

  assert.deepEqual(pendingDirectoryEntries, ['syscall_delegate_001.json']);
});
