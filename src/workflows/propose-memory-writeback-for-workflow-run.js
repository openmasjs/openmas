import { createHash } from 'node:crypto';
import { assertMemoryWritebackRequest } from '../contracts/memory/memory-writeback-contract.js';
import { assertWorkflowRunState } from '../contracts/workflows/workflow-run-state-contract.js';
import { assertWorkflowRuntimeDefinition } from '../contracts/workflows/workflow-runtime-contract.js';
import { truncateText } from '../memory/memory-reader-utils.js';
import { proposeMemoryWritebackForToolResult } from '../tools/propose-memory-writeback-for-tool-result.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function createStableWriteId(...parts) {
  return `write_${createSha256(parts.join('|')).slice(0, 32)}`;
}

function buildWorkflowRunSourceReference(workflowRunState) {
  return {
    kind: 'memory_source_reference',
    version: 1,
    sourceType: 'workflow_run',
    sourceId: workflowRunState.workflowRunId,
    scope: 'workflow',
    ownerId: workflowRunState.workflowId,
    path: `memory/state/workflows/${workflowRunState.workflowRunId}.json`,
    origin: 'workflow_generated',
    sensitivityLevel: 'internal',
    createdAt: workflowRunState.updatedAt,
    contentSha256: null,
  };
}

function buildWorkflowSubjectReferences(workflowRunState) {
  return [
    {
      subjectType: 'workflow_run',
      subjectId: workflowRunState.workflowRunId,
      relationship: 'source-workflow-run',
    },
    {
      subjectType: 'workflow',
      subjectId: workflowRunState.workflowId,
      relationship: 'workflow-definition',
    },
    {
      subjectType: 'operational_identity',
      subjectId: workflowRunState.operationalIdentityId,
      relationship: 'workflow-run-owner',
    },
    {
      subjectType: 'invocation',
      subjectId: workflowRunState.invocationId,
      relationship: 'source-invocation',
    },
  ];
}

function buildWorkflowStateCandidate({
  workflowRunState,
}) {
  const content = [
    `Workflow ${workflowRunState.workflowId} run ${workflowRunState.workflowRunId} reached status "${workflowRunState.status}".`,
    `Completed steps: ${workflowRunState.completedSteps.length}.`,
    `Blocked steps: ${workflowRunState.blockedSteps.length}.`,
    `Failed steps: ${workflowRunState.failedSteps.length}.`,
    `Tool runs: ${workflowRunState.toolRunIds.length}.`,
    'Raw tool outputs are intentionally not copied into this workflow memory candidate.',
  ].join(' ');

  return {
    kind: 'memory_write_candidate',
    writeId: createStableWriteId(
      'workflow-state',
      workflowRunState.workflowRunId,
      workflowRunState.status,
    ),
    writeType: 'task_state_update',
    targetMemoryType: 'workflow_state',
    scope: 'workflow',
    ownerId: workflowRunState.workflowId,
    origin: 'workflow_generated',
    portability: 'mas_bound',
    visibility: 'restricted',
    sensitivityLevel: 'internal',
    authorityLevel: 'runtime_evidence',
    summary: truncateText(
      `Workflow ${workflowRunState.workflowId} finished runtime state ${workflowRunState.status}.`,
      220,
    ),
    content,
    sourceReferences: [buildWorkflowRunSourceReference(workflowRunState)],
    subjectReferences: buildWorkflowSubjectReferences(workflowRunState),
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['workflow'],
      sourceOwnerIds: [workflowRunState.workflowId],
      mostRestrictiveVisibility: 'restricted',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The workflow produced useful runtime state that may be worth preserving after review.',
    warnings: [],
  };
}

function buildWorkflowArtifactReferenceCandidate({
  workflowRunState,
}) {
  return {
    kind: 'memory_write_candidate',
    writeId: createStableWriteId(
      'workflow-artifact-reference',
      workflowRunState.workflowRunId,
    ),
    writeType: 'artifact_reference',
    targetMemoryType: 'artifact_reference',
    scope: 'workflow',
    ownerId: workflowRunState.workflowId,
    origin: 'workflow_generated',
    portability: 'mas_bound',
    visibility: 'restricted',
    sensitivityLevel: 'internal',
    authorityLevel: 'runtime_evidence',
    summary: truncateText(
      `Workflow ${workflowRunState.workflowId} persisted final state artifact for run ${workflowRunState.workflowRunId}.`,
      220,
    ),
    content: null,
    sourceReferences: [buildWorkflowRunSourceReference(workflowRunState)],
    subjectReferences: buildWorkflowSubjectReferences(workflowRunState),
    approvalState: 'pending',
    redactionState: 'not_required',
    sourceGovernance: {
      sourceScopes: ['workflow'],
      sourceOwnerIds: [workflowRunState.workflowId],
      mostRestrictiveVisibility: 'restricted',
      highestSensitivityLevel: 'internal',
      requiresHumanApproval: false,
    },
    reason: 'The workflow persisted a final state artifact that can be reviewed without copying raw runtime bodies into memory.',
    warnings: [
      'Workflow persisted state is referenced as an artifact. The artifact body is not copied into this candidate.',
    ],
  };
}

function collectToolMemoryWrites({
  workflowRunResult,
  requestedBy,
}) {
  const memoryWrites = [];

  for (const stepResult of workflowRunResult.stepResults ?? []) {
    if (!stepResult.toolResult) {
      continue;
    }

    const toolWritebackRequest = proposeMemoryWritebackForToolResult({
      toolResult: stepResult.toolResult,
      toolDefinition: stepResult.toolDefinition ?? null,
      requestedBy,
    });

    memoryWrites.push(...toolWritebackRequest.memoryWrites);
  }

  return memoryWrites;
}

function uniqueCandidates(candidates) {
  const candidateByWriteId = new Map();

  for (const candidate of candidates) {
    candidateByWriteId.set(candidate.writeId, candidate);
  }

  return [...candidateByWriteId.values()];
}

export function proposeMemoryWritebackForWorkflowRun({
  workflowRunResult,
  requestedBy = 'workflow-runtime',
} = {}) {
  if (!isPlainObject(workflowRunResult)) {
    throw new Error('Workflow memory writeback proposal requires a workflowRunResult object.');
  }

  const workflowRunState = assertWorkflowRunState(workflowRunResult.workflowRunState);
  const workflowRuntimeDefinition = assertWorkflowRuntimeDefinition(workflowRunResult.workflowRuntimeDefinition);

  if (workflowRuntimeDefinition.memoryPolicy.allowWritebackCandidates !== true) {
    return assertMemoryWritebackRequest({
      kind: 'memory_writeback_request',
      version: 1,
      invocationId: workflowRunState.invocationId,
      requestedBy,
      requiresHumanApproval: false,
      memoryWrites: [],
      warnings: [
        `Runtime notice: Workflow ${workflowRunState.workflowId} runtime memory writeback candidates are disabled by workflow policy.`,
      ],
    });
  }

  const memoryWrites = uniqueCandidates([
    ...collectToolMemoryWrites({
      workflowRunResult,
      requestedBy,
    }),
    buildWorkflowStateCandidate({
      workflowRunState,
    }),
    buildWorkflowArtifactReferenceCandidate({
      workflowRunState,
    }),
  ]);

  return assertMemoryWritebackRequest({
    kind: 'memory_writeback_request',
    version: 1,
    invocationId: workflowRunState.invocationId,
    requestedBy: isNonEmptyString(requestedBy) ? requestedBy.trim() : 'workflow-runtime',
    requiresHumanApproval: memoryWrites.length > 0,
    memoryWrites,
    warnings: [
      'Workflow memory writeback candidates are pending review and are not durable memory records yet.',
    ],
  });
}
