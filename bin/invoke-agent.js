#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { runAgentInvocation } from '../src/invocation/run-agent-invocation.js';
import {
  admitJob,
  createJob,
  runJobNow,
} from '../src/os/manual-job-execution.js';
import { createLocalRuntimeAdapter } from '../src/os/adapters/local-runtime-adapter.js';
import { createLocalSystemCallInbox } from '../src/os/system-calls/local-system-call-inbox.js';
import {
  OPENMAS_OS_KINDS,
  OPENMAS_OS_SCHEMA_VERSION,
} from '../src/contracts/os/openmas-os-runtime-contract.js';
import {
  createOpenMasOsResultSummaryFromRecord,
} from '../src/contracts/os/openmas-os-result-record-contract.js';
import { normalizeConversationReference } from '../src/conversations/conversation-reference.js';
import { formatActionRuntimeUxForCli } from '../src/cli/action-runtime-ux.js';
import {
  formatRuntimeWarningRelevanceForCli,
  formatWarningTaxonomyForCli,
} from '../src/cli/warning-taxonomy.js';

const EXIT_CODE_BY_STATUS = {
  completed: 0,
  blocked: 2,
  failed: 3,
};

function normalizeConversationOptions(options) {
  if (!options.createConversationName || !options.conversationRef) {
    return options;
  }

  if (options.createConversationName !== options.conversationRef) {
    throw new Error(
      '--create-conversation and --conversation can only be combined when they reference the same conversation.',
    );
  }

  return {
    ...options,
    conversationRef: undefined,
  };
}

export function parseCommandLineArguments(argv) {
  const options = {
    projectRootPath: undefined,
    masRootHint: 'instance',
    operationalIdentityId: undefined,
    command: 'status',
    inputText: '',
    strict: false,
    requestedBy: 'cli',
    conversationRef: undefined,
    createConversationName: undefined,
    semanticIntentRuntimeMode: 'provider',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--strict') {
      options.strict = true;
      continue;
    }

    if (argument === '--semantic-intent') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --semantic-intent');
      }

      options.semanticIntentRuntimeMode = normalizeSemanticIntentMode(argv[index + 1]);
      index += 1;
      continue;
    }

    if (argument.startsWith('--semantic-intent=')) {
      options.semanticIntentRuntimeMode = normalizeSemanticIntentMode(
        argument.slice('--semantic-intent='.length),
      );
      continue;
    }

    if (argument === '--agent') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --agent');
      }

      assignOperationalIdentityAlias({
        options,
        value: argv[index + 1],
        argumentName: '--agent',
      });
      index += 1;
      continue;
    }

    if (argument.startsWith('--agent=')) {
      assignOperationalIdentityAlias({
        options,
        value: argument.slice('--agent='.length),
        argumentName: '--agent',
      });
      continue;
    }

    if (argument === '--operational-identity') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --operational-identity');
      }

      assignOperationalIdentityAlias({
        options,
        value: argv[index + 1],
        argumentName: '--operational-identity',
      });
      index += 1;
      continue;
    }

    if (argument.startsWith('--operational-identity=')) {
      assignOperationalIdentityAlias({
        options,
        value: argument.slice('--operational-identity='.length),
        argumentName: '--operational-identity',
      });
      continue;
    }

    if (argument === '--command') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --command');
      }

      options.command = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--command=')) {
      options.command = argument.slice('--command='.length);
      continue;
    }

    if (argument === '--mode' || argument === '--invocation-mode') {
      if (!argv[index + 1]) {
        throw new Error(`Missing value for ${argument}`);
      }

      options.invocationMode = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--mode=')) {
      options.invocationMode = argument.slice('--mode='.length);
      continue;
    }

    if (argument.startsWith('--invocation-mode=')) {
      options.invocationMode = argument.slice('--invocation-mode='.length);
      continue;
    }

    if (argument === '--input') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --input');
      }

      options.inputText = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === '--conversation') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --conversation');
      }

      options.conversationRef = normalizeConversationReference(
        argv[index + 1],
        'Conversation reference',
      );
      index += 1;
      continue;
    }

    if (argument.startsWith('--conversation=')) {
      options.conversationRef = normalizeConversationReference(
        argument.slice('--conversation='.length),
        'Conversation reference',
      );
      continue;
    }

    if (argument === '--create-conversation') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --create-conversation');
      }

      options.createConversationName = normalizeConversationReference(
        argv[index + 1],
        'Conversation name',
      );
      index += 1;
      continue;
    }

    if (argument.startsWith('--create-conversation=')) {
      options.createConversationName = normalizeConversationReference(
        argument.slice('--create-conversation='.length),
        'Conversation name',
      );
      continue;
    }

    if (argument.startsWith('--input=')) {
      options.inputText = argument.slice('--input='.length);
      continue;
    }

    if (argument === '--project-root') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --project-root');
      }

      options.projectRootPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--project-root=')) {
      options.projectRootPath = argument.slice('--project-root='.length);
      continue;
    }

    if (argument === '--mas-root') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --mas-root');
      }

      options.masRootHint = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--mas-root=')) {
      options.masRootHint = argument.slice('--mas-root='.length);
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  if (!options.operationalIdentityId) {
    throw new Error('The --operational-identity or --agent argument is required.');
  }

  return normalizeConversationOptions(options);
}

function assignOperationalIdentityAlias({
  options,
  value,
  argumentName,
}) {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue.length === 0) {
    throw new Error(`Missing value for ${argumentName}`);
  }

  if (
    options.operationalIdentityId
    && options.operationalIdentityId !== normalizedValue
  ) {
    throw new Error('--agent and --operational-identity must reference the same Operational Identity when both are provided.');
  }

  options.operationalIdentityId = normalizedValue;
}

export function shouldUseOsManagedCliInvocation(options) {
  return options.invocationMode === 'probabilistic'
    && Boolean(options.operationalIdentityId);
}

function resolveProjectRootPath(options) {
  return path.resolve(options.projectRootPath ?? process.cwd());
}

function buildCliOsJob({
  options,
  projectRootPath,
  createdAt,
}) {
  return {
    kind: OPENMAS_OS_KINDS.job,
    schemaVersion: OPENMAS_OS_SCHEMA_VERSION,
    jobId: `job_cli_${randomUUID()}`,
    projectId: 'project_openmas_cli',
    status: 'draft',
    createdBy: {
      type: 'human',
      id: options.requestedBy,
    },
    assignedOperationalIdentityId: options.operationalIdentityId,
    program: {
      type: 'agent_invocation',
      command: options.command,
      mode: options.invocationMode,
    },
    inputRef: {
      type: options.inputText && options.inputText.trim().length > 0 ? 'inline_text' : 'none',
      text: options.inputText ?? '',
    },
    conversationId: options.conversationRef ?? null,
    trigger: {
      type: 'immediate',
    },
    priority: 50,
    policies: {
      requiresApproval: false,
      maxAttempts: 1,
      noOverlap: false,
    },
    createdAt,
    updatedAt: createdAt,
    metadata: {
      projectRootPath,
      source: 'bin/invoke-agent.js',
    },
  };
}

function resolveLatestSystemCallId(result) {
  const toolExecution = result.output?.brainToolExecution ?? null;

  if (toolExecution?.executionPerformed !== true) {
    return null;
  }

  return toolExecution.observation?.dataPreview?.systemCall?.systemCallId ?? null;
}

async function loadLatestSystemCallResult({
  projectRootPath,
  result,
}) {
  const systemCallId = resolveLatestSystemCallId(result);

  if (!systemCallId) {
    return null;
  }

  const inbox = createLocalSystemCallInbox({ projectRootPath });

  if (!await inbox.hasSystemCallResult(systemCallId)) {
    return null;
  }

  return inbox.loadSystemCallResult(systemCallId);
}

function resolveOsExecutionRuntimeTruth({
  result,
  osExecution,
  resultSummary,
  latestSystemCallResult,
}) {
  const toolExecution = result.output?.brainToolExecution ?? null;
  const requestedToolId = toolExecution?.executionPerformed === true
    ? toolExecution.requestedToolId
    : null;
  const dataPreview = toolExecution?.observation?.dataPreview ?? null;

  if (requestedToolId === 'mas.os.delegate' && toolExecution.toolResultStatus === 'succeeded') {
    if (osExecution.thread.waitReason === 'waiting_for_child_process') {
      return {
        status: 'waiting',
        phase: 'waiting_for_child_result',
        final: false,
        completionScope: 'delegation_submission',
        summary: 'Delegation was accepted; the parent is waiting for the delegated child Result Record.',
      };
    }

    return {
      status: 'pending',
      phase: 'pending_kernel_processing',
      final: false,
      completionScope: 'delegation_submission',
      summary: 'Delegation was submitted for kernel processing; no delegated child result exists yet.',
    };
  }

  if (requestedToolId === 'mas.os.schedule_delegation' && toolExecution.toolResultStatus === 'succeeded') {
    if (['completed', 'accepted'].includes(latestSystemCallResult?.status) || dataPreview?.scheduled === true) {
      return {
        status: 'scheduled',
        phase: 'waiting_for_due_execution',
        final: false,
        completionScope: 'scheduled_submission',
        summary: 'Scheduled delegation was accepted; the scheduled child has not completed yet.',
      };
    }

    if (['denied', 'failed', 'expired', 'cancelled'].includes(latestSystemCallResult?.status)) {
      return {
        status: latestSystemCallResult.status,
        phase: 'scheduled_submission_rejected',
        final: true,
        completionScope: 'scheduled_submission',
        summary: latestSystemCallResult.summary,
      };
    }

    return {
      status: 'pending',
      phase: 'pending_kernel_processing',
      final: false,
      completionScope: 'scheduled_submission',
      summary: 'Scheduled delegation was submitted for kernel processing; the scheduled child has not run yet.',
    };
  }

  if (!resultSummary) {
    return {
      status: result.status,
      phase: 'invocation_status_only',
      final: result.status === 'completed' || result.status === 'failed',
      completionScope: 'invocation_turn',
      summary: result.message,
    };
  }

  const final = resultSummary.resultKind === 'foreground_completion_result';

  return {
    status: resultSummary.status,
    phase: final ? 'foreground_completed' : 'foreground_admitted',
    final,
    completionScope: 'foreground_execution',
    summary: resultSummary.summary,
  };
}

export async function runOsManagedCliInvocation(options, {
  invocationRunner,
} = {}) {
  const projectRootPath = resolveProjectRootPath(options);
  const adapter = createLocalRuntimeAdapter({ projectRootPath });
  const createdAt = new Date().toISOString();
  const createdJob = await createJob({
    adapter,
    job: buildCliOsJob({
      options,
      projectRootPath,
      createdAt,
    }),
    now: () => createdAt,
  });
  const admittedAt = new Date().toISOString();

  await admitJob({
    adapter,
    jobId: createdJob.jobId,
    now: () => admittedAt,
  });

  const osExecution = await runJobNow({
    adapter,
    projectRootPath,
    jobId: createdJob.jobId,
    invocationRunner,
    invocationOptions: {
      ...options,
      projectRootPath,
    },
  });
  const result = osExecution.invocationResult;

  result.osExecution = {
    jobId: osExecution.job.jobId,
    jobStatus: osExecution.job.status,
    processId: osExecution.process.processId,
    processStatus: osExecution.process.status,
    threadId: osExecution.thread.threadId,
    threadStatus: osExecution.thread.status,
    threadWaitReason: osExecution.thread.waitReason,
  };

  const foregroundResultRecord = osExecution.foregroundCompletionResult
    ?? osExecution.foregroundAdmissionResult
    ?? null;

  const resultSummary = foregroundResultRecord
    ? createOpenMasOsResultSummaryFromRecord(foregroundResultRecord)
    : null;

  if (resultSummary) {
    result.osExecution.resultSummary = resultSummary;
  }

  const latestSystemCallResult = await loadLatestSystemCallResult({
    projectRootPath,
    result,
  });

  if (latestSystemCallResult) {
    result.osExecution.latestSystemCallResult = latestSystemCallResult;
  }

  result.osExecution.runtimeTruth = resolveOsExecutionRuntimeTruth({
    result,
    osExecution,
    resultSummary,
    latestSystemCallResult,
  });

  return result;
}

function normalizeSemanticIntentMode(value) {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue === 'off') {
    return 'disabled';
  }

  if (['disabled', 'provider'].includes(normalizedValue)) {
    return normalizedValue;
  }

  throw new Error(`Unsupported --semantic-intent value: ${value}. Use provider, disabled, or off.`);
}

export function printInvocationSummary(result) {
  const request = result.request ?? {};
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const runtimeTruth = result.osExecution?.runtimeTruth ?? null;
  const visibleStatus = runtimeTruth?.status ?? result.status;

  console.log('OpenMAS Agent Invocation');
  console.log(`Status: ${visibleStatus}`);

  if (visibleStatus !== result.status) {
    console.log(`Invocation Turn Status: ${result.status}`);
  }

  const agentDisplayName = result.readiness?.operationalIdentityDefinition?.displayName
    ?? result.operationalDisplayName
    ?? result.operationalIdentityId
    ?? 'unresolved';

  console.log(`Agent: ${agentDisplayName}`);
  if (result.operationalIdentityId) {
    console.log(`Operational Identity: ${result.operationalIdentityId}`);
  }

  console.log(`Primary Cognitive Identity: ${result.primaryCognitiveIdentityId ?? 'unresolved'}`);
  console.log(`Command: ${request.command ?? 'unknown'}`);
  console.log(`Mode: ${request.invocationMode ?? 'unknown'}`);

  if (result.conversation?.conversationId) {
    console.log(`Conversation: ${result.conversation.conversationId}`);
  }

  if (result.osExecution) {
    console.log(`OS Job: ${result.osExecution.jobId} (${result.osExecution.jobStatus})`);
    console.log(`OS Process: ${result.osExecution.processId} (${result.osExecution.processStatus})`);
    console.log(`OS Thread: ${result.osExecution.threadId} (${result.osExecution.threadStatus})`);

    if (result.osExecution.resultSummary) {
      console.log(
        `OS Result: ${result.osExecution.resultSummary.resultId} (${result.osExecution.resultSummary.status})`,
      );
      console.log(`OS Result Kind: ${result.osExecution.resultSummary.resultKind}`);
      console.log(`OS Result Warnings: ${result.osExecution.resultSummary.warningCount}`);
    }

    if (result.osExecution.threadWaitReason) {
      console.log(`OS Thread Wait Reason: ${result.osExecution.threadWaitReason}`);
    }

    if (runtimeTruth) {
      console.log(`OS Runtime Truth: ${runtimeTruth.status} (${runtimeTruth.phase})`);
      console.log(`OS Runtime Final: ${runtimeTruth.final ? 'yes' : 'no'}`);
      console.log(`OS Runtime Summary: ${runtimeTruth.summary}`);
    }
  }

  console.log(`Message: ${result.message}`);
  console.log(`Next Step: ${result.nextStep}`);

  if (result.output?.executionType === 'probabilistic_brain') {
    console.log(`Provider: ${result.output.providerId}`);
    console.log(`Model: ${result.output.modelId}`);

    if (result.output.finishReason) {
      console.log(`Finish Reason: ${result.output.finishReason}`);
    }

    if (result.output.usage) {
      console.log(
        `Usage: input=${result.output.usage.inputTokens ?? 'n/a'} output=${result.output.usage.outputTokens ?? 'n/a'} total=${result.output.usage.totalTokens ?? 'n/a'}`,
      );
    }

    if (result.output.outputText) {
      console.log('');
      console.log(result.output.outputText);
    }

    printActionRuntimeSummary(result.output);
    printToolRuntimeSummary(result.output);
    printWorkflowRuntimeSummary(result.output);
  }

  if (result.persistence) {
    console.log(`Persistence Target: ${result.persistence.targetType}`);
    console.log(`Invocation Session Record: ${result.persistence.invocationSessionRecordPath}`);
    console.log(`Invocation Report: ${result.persistence.invocationReportPath}`);
  }

  if (warnings.length > 0) {
    console.log('');

    const warningLines = result.warningRelevance
      ? formatRuntimeWarningRelevanceForCli(result.warningRelevance)
      : formatWarningTaxonomyForCli(warnings, {
        runtimeContext: {
          request,
          readiness: result.readiness,
          output: result.output,
        },
      });

    for (const line of warningLines) {
      console.log(line);
    }
  }

  if (errors.length > 0) {
    console.log(`Errors: ${errors.join(' | ')}`);
  }
}

function printActionRuntimeSummary(output) {
  const actionRuntimeLines = formatActionRuntimeUxForCli(output);

  if (actionRuntimeLines.length === 0) {
    return;
  }

  console.log('');

  for (const line of actionRuntimeLines) {
    console.log(line);
  }
}

function printToolRuntimeSummary(output) {
  const resolution = output.toolRequestResolution;
  const execution = output.brainToolExecution;
  const observation = output.brainToolObservation;

  if (!resolution || resolution.status === 'no_request') {
    return;
  }

  console.log('');
  console.log(`Tool Request: ${resolution.status}`);

  if (resolution.requestedToolId) {
    console.log(`Requested Tool: ${resolution.requestedToolId}`);
  }

  console.log(`Tool Runtime Action: ${resolution.runtimeAction}`);
  console.log(`Tool Request Reason: ${resolution.reason}`);

  if (execution) {
    console.log(`Tool Execution: ${execution.status}`);
    console.log(`Tool Execution Performed: ${execution.executionPerformed ? 'yes' : 'no'}`);

    if (execution.toolRunId) {
      console.log(`Tool Run ID: ${execution.toolRunId}`);
    }

    if (execution.reason) {
      console.log(`Tool Execution Reason: ${execution.reason}`);
    }
  }

  if (observation) {
    console.log(`Tool Observation: ${observation.status}`);
    console.log(`Tool Observation Summary: ${observation.summary}`);
  }
}

function printWorkflowRuntimeSummary(output) {
  const resolution = output.workflowRequestResolution;
  const execution = output.brainWorkflowExecution;
  const observation = output.brainWorkflowObservation;

  if (!resolution || resolution.status === 'no_request') {
    return;
  }

  console.log('');
  console.log(`Workflow Request: ${resolution.status}`);

  if (resolution.requestedWorkflowId) {
    console.log(`Requested Workflow: ${resolution.requestedWorkflowId}`);
  }

  console.log(`Workflow Runtime Action: ${resolution.runtimeAction}`);
  console.log(`Workflow Request Reason: ${resolution.reason}`);

  if (execution) {
    console.log(`Workflow Execution: ${execution.status}`);
    console.log(`Workflow Execution Performed: ${execution.executionPerformed ? 'yes' : 'no'}`);

    if (execution.workflowRunId) {
      console.log(`Workflow Run ID: ${execution.workflowRunId}`);
    }

    if (execution.reason) {
      console.log(`Workflow Execution Reason: ${execution.reason}`);
    }
  }

  if (observation) {
    console.log(`Workflow Observation: ${observation.status}`);
    console.log(`Workflow Observation Summary: ${observation.summary}`);
  }
}

async function main() {
  try {
    const options = parseCommandLineArguments(process.argv.slice(2));
    const result = shouldUseOsManagedCliInvocation(options)
      ? await runOsManagedCliInvocation(options)
      : await runAgentInvocation(options);

    printInvocationSummary(result);
    process.exitCode = EXIT_CODE_BY_STATUS[result.status] ?? EXIT_CODE_BY_STATUS.failed;
  } catch (error) {
    console.error('OpenMAS Agent Invocation');
    console.error('Status: failed');
    console.error(`Error: ${error.message}`);
    process.exitCode = EXIT_CODE_BY_STATUS.failed;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
