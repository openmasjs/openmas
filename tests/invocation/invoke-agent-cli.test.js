import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import {
  parseCommandLineArguments,
  printInvocationSummary,
  runOsManagedCliInvocation,
} from '../../bin/invoke-agent.js';
import { OPENMAS_OS_SYSTEM_CALL_KINDS } from '../../src/contracts/os/openmas-os-system-call-contract.js';
import { createLocalSystemCallInbox } from '../../src/os/system-calls/local-system-call-inbox.js';

function createProbabilisticOptions(projectRootPath) {
  return parseCommandLineArguments([
    '--project-root',
    projectRootPath,
    '--operational-identity',
    'alfred',
    '--mode',
    'probabilistic',
    '--command',
    'ask',
    '--input',
    'Coordinate work through OpenMAS OS.',
  ]);
}

function createStubInvocationResult(overrides = {}) {
  return {
    invocationId: 'invocation_cli_runtime_truth_stub',
    primaryCognitiveIdentityId: 'system-steward',
    operationalIdentityId: 'alfred',
    status: 'completed',
    request: {
      command: 'ask',
      invocationMode: 'probabilistic',
    },
    message: 'Invocation turn completed.',
    nextStep: 'Inspect runtime evidence.',
    readiness: {
      operationalIdentityDefinition: {
        displayName: 'Alfred',
      },
    },
    warnings: [],
    errors: [],
    persistence: null,
    output: null,
    ...overrides,
  };
}

function captureInvocationSummary(result) {
  const lines = [];
  const originalLog = console.log;

  console.log = (...values) => {
    lines.push(values.join(' '));
  };

  try {
    printInvocationSummary(result);
  } finally {
    console.log = originalLog;
  }

  return lines.join('\n');
}

test('invoke-agent CLI treats matching --create-conversation and --conversation as create-and-talk', () => {
  const options = parseCommandLineArguments([
    '--operational-identity',
    'alfred',
    '--mode',
    'probabilistic',
    '--command',
    'ask',
    '--create-conversation',
    'alfred-admin',
    '--conversation',
    'alfred-admin',
    '--input',
    'Hola Alfred.',
  ]);

  assert.equal(options.createConversationName, 'alfred-admin');
  assert.equal(options.conversationRef, undefined);
});

test('invoke-agent CLI rejects different create and resume conversation names clearly', () => {
  assert.throws(
    () => parseCommandLineArguments([
      '--operational-identity',
      'alfred',
      '--mode',
      'probabilistic',
      '--create-conversation',
      'alfred-admin',
      '--conversation',
      'bruce-admin',
    ]),
    /can only be combined when they reference the same conversation/u,
  );
});

test('invoke-agent CLI accepts --agent as an Operational Identity alias', () => {
  const options = parseCommandLineArguments([
    '--agent',
    'alfred',
    '--command',
    'hello',
  ]);

  assert.equal(options.operationalIdentityId, 'alfred');
  assert.equal(Object.hasOwn(options, 'agentId'), false);
});

test('invoke-agent CLI accepts --agent=value as an Operational Identity alias', () => {
  const options = parseCommandLineArguments([
    '--agent=bruce',
    '--command',
    'hello',
  ]);

  assert.equal(options.operationalIdentityId, 'bruce');
  assert.equal(Object.hasOwn(options, 'agentId'), false);
});

test('invoke-agent CLI rejects conflicting Operational Identity aliases', () => {
  assert.throws(
    () => parseCommandLineArguments([
      '--agent',
      'alfred',
      '--operational-identity',
      'bruce',
      '--command',
      'hello',
    ]),
    /must reference the same Operational Identity/u,
  );
});

test('invoke-agent CLI no longer accepts the old legacy intent compatibility switch', () => {
  assert.throws(
    () => parseCommandLineArguments([
      '--agent',
      'alfred',
      '--legacy-intent-compatibility',
      'compatibility',
      '--command',
      'hello',
    ]),
    /Unsupported argument: --legacy-intent-compatibility/u,
  );
});

test('OS-managed invoke-agent create-and-talk passes only createConversationName to invocation runner', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-invoke-agent-cli-'));
  const options = parseCommandLineArguments([
    '--project-root',
    projectRootPath,
    '--operational-identity',
    'alfred',
    '--mode',
    'probabilistic',
    '--command',
    'ask',
    '--create-conversation',
    'alfred-admin',
    '--conversation',
    'alfred-admin',
    '--input',
    'Hola Alfred.',
  ]);
  let invocationOptions = null;

  const result = await runOsManagedCliInvocation(options, {
    invocationRunner: async (receivedOptions) => {
      invocationOptions = receivedOptions;

      return {
        invocationId: 'invocation_cli_create_and_talk_stub',
        primaryCognitiveIdentityId: 'system-steward',
        operationalIdentityId: receivedOptions.operationalIdentityId,
        status: 'completed',
        request: {
          command: receivedOptions.command,
          invocationMode: receivedOptions.invocationMode,
        },
        message: 'Stub invocation completed.',
        nextStep: 'No action needed.',
        warnings: [],
        errors: [],
        persistence: null,
        output: null,
      };
    },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.osExecution.jobStatus, 'completed');
  assert.equal(result.osExecution.resultSummary.resultKind, 'foreground_completion_result');
  assert.equal(result.osExecution.resultSummary.status, 'completed');
  assert.match(result.osExecution.resultSummary.summary, /Stub invocation completed/u);
  assert.equal(invocationOptions.createConversationName, 'alfred-admin');
  assert.equal(invocationOptions.conversationRef, undefined);
  assert.equal(invocationOptions.command, 'ask');
});

test('OS-managed invoke-agent exposes immediate delegation submission as pending instead of completed child work', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-invoke-agent-cli-'));
  const result = await runOsManagedCliInvocation(createProbabilisticOptions(projectRootPath), {
    invocationRunner: async () => createStubInvocationResult({
      message: 'Delegation request turn completed.',
      output: {
        brainToolExecution: {
          executionPerformed: true,
          requestedToolId: 'mas.os.delegate',
          toolResultStatus: 'succeeded',
          observation: {
            dataPreview: {
              delegated: false,
              systemCall: {
                operation: 'delegate',
                status: 'pending',
              },
            },
          },
        },
      },
    }),
  });
  const output = captureInvocationSummary(result);

  assert.equal(result.status, 'completed');
  assert.equal(result.osExecution.resultSummary.resultKind, 'foreground_admission_result');
  assert.equal(result.osExecution.runtimeTruth.status, 'pending');
  assert.equal(result.osExecution.runtimeTruth.final, false);
  assert.match(output, /Status: pending/u);
  assert.match(output, /Invocation Turn Status: completed/u);
  assert.match(output, /Agent: Alfred/u);
  assert.match(output, /Operational Identity: alfred/u);
  assert.match(output, /Primary Cognitive Identity: system-steward/u);
  assert.match(output, /OS Runtime Truth: pending \(pending_kernel_processing\)/u);
  assert.match(output, /no delegated child result exists yet/u);
});

test('OS-managed invoke-agent exposes scheduled submission as scheduled without claiming child execution', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-invoke-agent-cli-'));
  const result = await runOsManagedCliInvocation(createProbabilisticOptions(projectRootPath), {
    invocationRunner: async () => createStubInvocationResult({
      message: 'Scheduling request turn completed.',
      output: {
        brainToolExecution: {
          executionPerformed: true,
          requestedToolId: 'mas.os.schedule_delegation',
          toolResultStatus: 'succeeded',
          observation: {
            dataPreview: {
              scheduled: true,
              systemCall: {
                operation: 'schedule_delegation',
                status: 'completed',
              },
            },
          },
        },
      },
    }),
  });
  const output = captureInvocationSummary(result);

  assert.equal(result.status, 'completed');
  assert.equal(result.osExecution.resultSummary.resultKind, 'foreground_completion_result');
  assert.equal(result.osExecution.runtimeTruth.status, 'scheduled');
  assert.equal(result.osExecution.runtimeTruth.final, false);
  assert.match(output, /Status: scheduled/u);
  assert.match(output, /Invocation Turn Status: completed/u);
  assert.match(output, /Agent: Alfred/u);
  assert.match(output, /Operational Identity: alfred/u);
  assert.match(output, /Primary Cognitive Identity: system-steward/u);
  assert.match(output, /OS Runtime Truth: scheduled \(waiting_for_due_execution\)/u);
  assert.match(output, /scheduled child has not completed yet/u);
});

test('OS-managed invoke-agent prefers durable scheduled System Call truth over a stale invocation preview', async () => {
  const projectRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-invoke-agent-cli-'));
  const systemCallId = 'syscall_schedule_delegation_cli_durable_truth_001';
  const inbox = createLocalSystemCallInbox({ projectRootPath });
  const result = await runOsManagedCliInvocation(createProbabilisticOptions(projectRootPath), {
    invocationRunner: async () => {
      await inbox.persistSystemCallResult({
        kind: OPENMAS_OS_SYSTEM_CALL_KINDS.result,
        schemaVersion: 1,
        systemCallId,
        operation: 'schedule_delegation',
        status: 'completed',
        processedAt: '2026-05-31T10:00:00-05:00',
        processedBy: {
          serviceId: 'openmas_os_service_cli_truth_test',
          tickId: 'os_service_tick_cli_truth_test',
        },
        decision: {
          allowed: true,
          reason: 'Scheduled delegation accepted for durable-truth CLI regression.',
        },
        effects: {
          createdJobIds: ['job_syscall_schedule_delegation_cli_durable_truth_001'],
          createdTimerIds: ['timer_job_syscall_schedule_delegation_cli_durable_truth_001'],
          createdSignalIds: [],
          createdProcessIds: [],
          createdThreadIds: [],
          eventIds: [],
        },
        summary: 'OpenMAS OS scheduled a delegated child Job.',
        correlation: {
          invocationId: 'invocation_cli_runtime_truth_stub',
        },
        evidenceRefs: [],
        warnings: [],
        details: {
          childJobId: 'job_syscall_schedule_delegation_cli_durable_truth_001',
          timerId: 'timer_job_syscall_schedule_delegation_cli_durable_truth_001',
        },
      });

      return createStubInvocationResult({
        message: 'Stale scheduling preview returned.',
        output: {
          brainToolExecution: {
            executionPerformed: true,
            requestedToolId: 'mas.os.schedule_delegation',
            toolResultStatus: 'succeeded',
            observation: {
              dataPreview: {
                scheduled: false,
                systemCall: {
                  systemCallId,
                  operation: 'schedule_delegation',
                  status: 'pending',
                },
              },
            },
          },
        },
      });
    },
  });

  assert.equal(result.osExecution.latestSystemCallResult.status, 'completed');
  assert.equal(result.osExecution.runtimeTruth.status, 'scheduled');
  assert.equal(result.osExecution.runtimeTruth.phase, 'waiting_for_due_execution');
});
