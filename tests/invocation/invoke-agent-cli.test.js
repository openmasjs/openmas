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

test('invoke-agent CLI rejects direct Cognitive Identity execution through --agent', () => {
  assert.throws(
    () => parseCommandLineArguments([
      '--agent',
      'system-steward',
      '--command',
      'hello',
    ]),
    /Direct Cognitive Identity execution is not supported/u,
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
