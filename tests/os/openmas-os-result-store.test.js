import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { createLocalRuntimeAdapter } from '../../src/os/adapters/local-runtime-adapter.js';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_RESULT_RECORD_KINDS,
} from '../../src/contracts/openmas-os-result-record-contract.js';

const NOW = '2026-05-23T10:00:00-05:00';
const LATER = '2026-05-23T10:00:07-05:00';
const LATEST = '2026-05-23T10:00:09-05:00';

async function createTemporaryProjectRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'openmas-result-store-'));
}

async function assertFileExists(filePath) {
  await access(filePath);
}

function createResultRecord(overrides = {}) {
  return {
    kind: OPENMAS_OS_RESULT_RECORD_KINDS.resultRecord,
    schemaVersion: 1,
    resultId: 'result_process_bruce_inspection_001',
    resultKind: 'process_result',
    producer: {
      type: 'process',
      id: 'process_bruce_inspection_001',
      operationalIdentityId: 'bruce',
      activeCognitiveIdentityId: 'evaluation-audit-steward',
    },
    lineage: {
      jobId: 'job_bruce_inspection_001',
      processId: 'process_bruce_inspection_001',
      threadId: 'thread_bruce_inspection_001',
      parentProcessId: 'process_alfred_delegate_001',
      systemCallId: 'syscall_delegate_001',
      toolRunId: 'tool-run-001',
    },
    status: 'completed',
    phase: 'terminal',
    completion: {
      startedAt: NOW,
      completedAt: LATER,
      durationMs: 7000,
      exitClass: 'success',
    },
    summary: 'Bruce completed the delegated runtime inspection.',
    artifactRefs: [
      'memory/artifacts/probabilistic-brain-invocation-001.md',
    ],
    toolRunRefs: [
      'tool-run-001',
    ],
    workflowRunRefs: [],
    childResultRefs: [],
    warnings: [],
    failure: null,
    verification: {
      status: 'passed',
      grounded: true,
    },
    visibility: {
      safeForHumanSummary: true,
      safeForAgentContext: true,
    },
    metadata: {},
    createdAt: LATER,
    ...overrides,
  };
}

function createWarning() {
  return {
    source: {
      type: 'tool_runtime',
      id: 'tool-run-002',
    },
    severity: 'info',
    message: 'Tool memory writeback candidates are disabled by tool policy.',
    affectsResultTrust: false,
    requiresHumanAction: false,
  };
}

test('LocalRuntimeAdapter initializes the Result Store layout under instance/os/results', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const layout = await adapter.initialize();

  assert.equal(layout.resultsRootPath, path.join(projectRootPath, 'instance', 'os', 'results'));
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'results'));
});

test('Result Store persists, loads, lists, and finds Result Records by lineage', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const childResult = await adapter.persistResultRecord(createResultRecord({
    resultId: 'result_child_bruce_001',
    createdAt: LATER,
  }));
  const parentResult = await adapter.persistResultRecord(createResultRecord({
    resultId: 'result_parent_alfred_001',
    resultKind: 'parent_resume_result',
    producer: {
      type: 'process',
      id: 'process_alfred_delegate_001',
      operationalIdentityId: 'alfred',
      activeCognitiveIdentityId: 'system-steward',
    },
    lineage: {
      jobId: 'job_alfred_delegate_001',
      processId: 'process_alfred_delegate_001',
      threadId: 'thread_alfred_resume_001',
      parentProcessId: null,
      systemCallId: 'syscall_delegate_001',
    },
    summary: 'Alfred resumed after Bruce completed delegated work.',
    childResultRefs: [
      'result_child_bruce_001',
    ],
    createdAt: LATEST,
  }));
  const warningResult = await adapter.persistResultRecord(createResultRecord({
    resultId: 'result_child_bruce_002',
    lineage: {
      jobId: 'job_bruce_inspection_001',
      processId: 'process_bruce_inspection_002',
      threadId: 'thread_bruce_inspection_002',
      parentProcessId: 'process_alfred_delegate_001',
      systemCallId: 'syscall_delegate_001',
      toolRunId: 'tool-run-002',
    },
    status: 'completed_with_warnings',
    completion: {
      startedAt: NOW,
      completedAt: LATEST,
      durationMs: 9000,
      exitClass: 'warnings',
    },
    warnings: [
      createWarning(),
    ],
    createdAt: NOW,
  }));

  assert.deepEqual(await adapter.loadResultRecord(childResult.resultId), childResult);
  await assertFileExists(path.join(projectRootPath, 'instance', 'os', 'results', `${childResult.resultId}.json`));

  assert.deepEqual(
    (await adapter.listResultRecords({ jobId: 'job_bruce_inspection_001' })).map((result) => result.resultId),
    [
      'result_child_bruce_001',
      'result_child_bruce_002',
    ],
  );
  assert.deepEqual(
    (await adapter.listRecentResultRecords({ limit: 2 })).map((result) => result.resultId),
    [
      parentResult.resultId,
      childResult.resultId,
    ],
  );
  assert.deepEqual(
    (await adapter.findResultRecordsByJob('job_bruce_inspection_001')).map((result) => result.resultId),
    [
      childResult.resultId,
      warningResult.resultId,
    ],
  );
  assert.deepEqual(
    (await adapter.findResultRecordsByProcess('process_bruce_inspection_001')).map((result) => result.resultId),
    [
      childResult.resultId,
    ],
  );
  assert.deepEqual(
    (await adapter.findChildResultRecordsByParentProcess('process_alfred_delegate_001')).map((result) => result.resultId),
    [
      childResult.resultId,
      warningResult.resultId,
    ],
  );
  assert.deepEqual(
    (await adapter.listResultRecords({ operationalIdentityId: 'alfred' })).map((result) => result.resultId),
    [
      parentResult.resultId,
    ],
  );
});

test('Result Store is write-once by resultId and rejects unsafe ids before path resolution', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistResultRecord(createResultRecord());

  await assert.rejects(
    () => adapter.persistResultRecord(createResultRecord()),
    /already exists/u,
  );

  assert.throws(
    () => adapter.resolveResultRecordSnapshotPath('../unsafe'),
    /unsafe characters/u,
  );

  await assert.rejects(
    () => adapter.loadResultRecord('..\\unsafe'),
    /unsafe characters/u,
  );
});

test('Result Store inspection isolates malformed result files without hiding read errors', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await adapter.persistResultRecord(createResultRecord());
  await mkdir(path.join(projectRootPath, 'instance', 'os', 'results'), { recursive: true });
  await writeFile(
    path.join(projectRootPath, 'instance', 'os', 'results', 'result_broken.json'),
    '{',
    'utf8',
  );

  const inspection = await adapter.inspectResultRecords();

  assert.deepEqual(
    inspection.records.map((result) => result.resultId),
    [
      'result_process_bruce_inspection_001',
    ],
  );
  assert.equal(inspection.readErrors.length, 1);
  assert.match(inspection.readErrors[0].message, /could not be parsed as JSON/u);

  await assert.rejects(
    () => adapter.listResultRecords(),
    /could not be parsed as JSON/u,
  );
});

test('Result Store rejects raw secrets before persistence', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  await assert.rejects(
    () => adapter.persistResultRecord(createResultRecord({
      metadata: {
        apiKey: buildFakeOpenRouterSecretProbe('secretvalue'),
      },
    })),
    /raw secret-like field/u,
  );
});

test('Result Store does not leave temporary atomic-write files behind', async () => {
  const projectRootPath = await createTemporaryProjectRoot();
  const adapter = createLocalRuntimeAdapter({ projectRootPath });

  const result = await adapter.persistResultRecord(createResultRecord());
  const resultDirectoryEntries = await readdir(path.join(projectRootPath, 'instance', 'os', 'results'));

  assert.deepEqual(resultDirectoryEntries, [`${result.resultId}.json`]);
});
