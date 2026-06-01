const WORKFLOW_RUN_STATUSES = new Set([
  'created',
  'running',
  'waiting_for_approval',
  'waiting_for_external_event',
  'succeeded',
  'failed',
  'cancelled',
]);

const WORKFLOW_TERMINAL_RUN_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

const SAFE_WORKFLOW_RUN_ID_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertEnumValue(value, allowedValues, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!allowedValues.has(normalizedValue)) {
    throw new Error(`${description} is invalid: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertSafeIdentifier(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (!SAFE_WORKFLOW_RUN_ID_PATTERN.test(normalizedValue)) {
    throw new Error(`${description} contains unsafe characters: ${normalizedValue}`);
  }

  return normalizedValue;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  const seenValues = new Set();

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      throw new Error(`${description} contains a duplicated value: ${normalizedValue}`);
    }

    seenValues.add(normalizedValue);
    return normalizedValue;
  });
}

function assertNullableSafeIdentifier(value, description) {
  if (value === undefined || value === null) {
    return null;
  }

  return assertSafeIdentifier(value, description);
}

function assertArtifactReference(reference, index) {
  const description = `Workflow run state artifactReferences[${index}]`;

  if (!isPlainObject(reference)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(reference.artifactId)) {
    throw new Error(`${description} must include a non-empty artifactId.`);
  }

  if (!isNonEmptyString(reference.path)) {
    throw new Error(`${description} must include a non-empty path.`);
  }

  return {
    artifactId: reference.artifactId.trim(),
    artifactKind: isNonEmptyString(reference.artifactKind) ? reference.artifactKind.trim() : null,
    path: reference.path.trim(),
    summary: isNonEmptyString(reference.summary) ? reference.summary.trim() : null,
  };
}

function assertArtifactReferences(references) {
  if (!Array.isArray(references)) {
    throw new Error('Workflow run state artifactReferences must be an array.');
  }

  const seenArtifactIds = new Set();

  return references.map((reference, index) => {
    const normalizedReference = assertArtifactReference(reference, index);

    if (seenArtifactIds.has(normalizedReference.artifactId)) {
      throw new Error(`Workflow run state artifactReferences contains a duplicated artifactId: ${normalizedReference.artifactId}`);
    }

    seenArtifactIds.add(normalizedReference.artifactId);
    return normalizedReference;
  });
}

function assertWorkflowRunConsistency(state) {
  if (state.status === 'waiting_for_approval' && state.approvalRequests.length === 0) {
    throw new Error('Workflow run state with status "waiting_for_approval" must include at least one approval request.');
  }

  if (state.status === 'succeeded' && state.failedSteps.length > 0) {
    throw new Error('Workflow run state with status "succeeded" must not include failedSteps.');
  }

  if (state.status === 'succeeded' && state.blockedSteps.length > 0) {
    throw new Error('Workflow run state with status "succeeded" must not include blockedSteps.');
  }

  if (WORKFLOW_TERMINAL_RUN_STATUSES.has(state.status) && state.currentStepId !== null) {
    throw new Error(`Workflow run state with terminal status "${state.status}" must not include currentStepId.`);
  }
}

export function assertWorkflowRunState(state) {
  if (!isPlainObject(state)) {
    throw new Error('Workflow run state must be an object.');
  }

  if (state.kind !== 'workflow_run_state') {
    throw new Error('Workflow run state must include kind "workflow_run_state".');
  }

  if (!Number.isInteger(state.version) || state.version < 1) {
    throw new Error('Workflow run state must include an integer version greater than or equal to 1.');
  }

  if (!isNonEmptyString(state.workflowRunId)) {
    throw new Error('Workflow run state must include a non-empty workflowRunId.');
  }

  if (!isNonEmptyString(state.workflowId)) {
    throw new Error('Workflow run state must include a non-empty workflowId.');
  }

  if (!isNonEmptyString(state.operationalIdentityId)) {
    throw new Error('Workflow run state must include a non-empty operationalIdentityId.');
  }

  if (!isNonEmptyString(state.invocationId)) {
    throw new Error('Workflow run state must include a non-empty invocationId.');
  }

  if (!isNonEmptyString(state.createdAt)) {
    throw new Error('Workflow run state must include a non-empty createdAt.');
  }

  if (!isNonEmptyString(state.updatedAt)) {
    throw new Error('Workflow run state must include a non-empty updatedAt.');
  }

  const normalizedState = {
    kind: state.kind,
    version: state.version,
    workflowRunId: assertSafeIdentifier(state.workflowRunId, 'Workflow run state workflowRunId'),
    workflowId: assertSafeIdentifier(state.workflowId, 'Workflow run state workflowId'),
    status: assertEnumValue(state.status, WORKFLOW_RUN_STATUSES, 'Workflow run state status'),
    operationalIdentityId: state.operationalIdentityId.trim(),
    invocationId: state.invocationId.trim(),
    currentStepId: assertNullableSafeIdentifier(state.currentStepId, 'Workflow run state currentStepId'),
    completedSteps: assertStringArray(state.completedSteps ?? [], 'Workflow run state completedSteps'),
    blockedSteps: assertStringArray(state.blockedSteps ?? [], 'Workflow run state blockedSteps'),
    failedSteps: assertStringArray(state.failedSteps ?? [], 'Workflow run state failedSteps'),
    approvalRequests: assertStringArray(state.approvalRequests ?? [], 'Workflow run state approvalRequests'),
    toolRunIds: assertStringArray(state.toolRunIds ?? [], 'Workflow run state toolRunIds'),
    artifactReferences: assertArtifactReferences(state.artifactReferences ?? []),
    memoryWritebackCandidateIds: assertStringArray(
      state.memoryWritebackCandidateIds ?? [],
      'Workflow run state memoryWritebackCandidateIds',
    ),
    createdAt: state.createdAt.trim(),
    updatedAt: state.updatedAt.trim(),
    warnings: assertStringArray(state.warnings ?? [], 'Workflow run state warnings'),
  };

  assertWorkflowRunConsistency(normalizedState);

  return normalizedState;
}

export function isWorkflowRunTerminal(state) {
  return WORKFLOW_TERMINAL_RUN_STATUSES.has(assertWorkflowRunState(state).status);
}

export {
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_TERMINAL_RUN_STATUSES,
};
