import crypto from 'node:crypto';
import { assertWorkflowRunState } from '../contracts/workflows/workflow-run-state-contract.js';
import { assertWorkflowRuntimeDefinition } from '../contracts/workflows/workflow-runtime-contract.js';
import { readResourcesRegistry } from '../operational-identities/read-resources-registry.js';
import { resolveOperationalIdentityRoot } from '../operational-identities/resolve-operational-identity-root.js';
import { readBindingDefinitions } from '../operational-identities/read-binding-definitions.js';
import { readPermissionDefinitions } from '../operational-identities/read-permission-definitions.js';
import { resolveBindingsForInvocation } from '../operational-identities/resolve-bindings-for-invocation.js';
import { evaluatePermissionsForInvocation } from '../operational-identities/evaluate-permissions-for-invocation.js';
import { readToolDefinitions } from '../tools/read-tool-definitions.js';
import { evaluateToolReadinessForInvocation } from '../tools/evaluate-tool-readiness-for-invocation.js';
import { executeLocalReadOnlyToolForInvocation } from '../tools/execute-local-read-only-tool-for-invocation.js';
import { persistToolResultForInvocation } from '../tools/persist-tool-result-for-invocation.js';
import { writeMemoryWritebackRequest } from '../context/write-memory-writeback-request.js';
import { createWorkflowRunState } from './create-workflow-run-state.js';
import { proposeMemoryWritebackForWorkflowRun } from './propose-memory-writeback-for-workflow-run.js';
import { readWorkflowRuntimeDefinition } from './read-workflow-runtime-definitions.js';
import { writeWorkflowRunState } from './write-workflow-run-state.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNonEmptyString(value, description) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${description} must be a non-empty string.`);
  }

  return value.trim();
}

function createMapById(values, idFieldName) {
  return new Map(values.map((value) => [value[idFieldName], value]));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => isNonEmptyString(value)).map((value) => value.trim()))];
}

function createWorkflowApprovalRequestId({
  workflowRunId,
  stepId,
}) {
  return `workflow-approval-${workflowRunId}-${stepId}`;
}

function findToolReadinessVerdict({
  toolReadinessEvaluation,
  toolId,
}) {
  return toolReadinessEvaluation.evaluatedTools.find((verdict) => verdict.toolId === toolId) ?? null;
}

function resolveNextEligibleStep({
  workflowRuntimeDefinition,
  completedSteps,
}) {
  const completedStepIds = new Set(completedSteps);

  return workflowRuntimeDefinition.steps.find((step) => {
    return !completedStepIds.has(step.stepId) && step.dependsOn.every((stepId) => completedStepIds.has(stepId));
  }) ?? null;
}

function allStepsCompleted({
  workflowRuntimeDefinition,
  completedSteps,
}) {
  const completedStepIds = new Set(completedSteps);

  return workflowRuntimeDefinition.steps.every((step) => completedStepIds.has(step.stepId));
}

function mergeArtifactReferences({
  currentReferences,
  nextReferences,
}) {
  const referencesById = new Map();

  for (const reference of [...currentReferences, ...nextReferences]) {
    referencesById.set(reference.artifactId, reference);
  }

  return [...referencesById.values()];
}

function normalizeWorkflowRuntimeDefinition({
  workflowRuntimeDefinition,
  workflowId,
}) {
  if (!workflowRuntimeDefinition) {
    if (!isNonEmptyString(workflowId)) {
      throw new Error('Workflow runner requires workflowId when workflowRuntimeDefinition is not provided.');
    }

    return null;
  }

  const definition = assertWorkflowRuntimeDefinition(workflowRuntimeDefinition);

  if (isNonEmptyString(workflowId) && definition.workflowId !== workflowId.trim()) {
    throw new Error(`Workflow runner workflowId "${workflowId}" does not match workflowRuntimeDefinition.workflowId "${definition.workflowId}".`);
  }

  return definition;
}

async function resolveWorkflowDefinition({
  masRootPath,
  workflowId,
  workflowRuntimeDefinition,
}) {
  const normalizedDefinition = normalizeWorkflowRuntimeDefinition({
    workflowRuntimeDefinition,
    workflowId,
  });

  if (normalizedDefinition) {
    return {
      workflowRuntimeDefinition: normalizedDefinition,
      warnings: [],
    };
  }

  const readerResult = await readWorkflowRuntimeDefinition({
    masRootPath,
    workflowId,
  });

  if (!readerResult.workflowRuntimeDefinition) {
    throw new Error(readerResult.warnings[0] ?? `Workflow runtime definition could not be resolved: ${workflowId}`);
  }

  return readerResult;
}

async function resolveOperationalRuntime({
  masRootPath,
  operationalIdentityId,
  resolvedBindings,
  permissionEvaluation,
}) {
  if (Array.isArray(resolvedBindings) && permissionEvaluation) {
    return {
      resolvedBindings,
      permissionEvaluation,
      warnings: [],
    };
  }

  const {
    registry,
  } = await readResourcesRegistry({
    masRootPath,
  });

  if (!registry) {
    throw new Error('Workflow runner requires a resource registry when resolvedBindings are not provided.');
  }

  const {
    operationalIdentityRootPath,
  } = await resolveOperationalIdentityRoot({
    masRootPath,
    operationalIdentityId,
  });
  const {
    bindings,
  } = await readBindingDefinitions({
    operationalIdentityRootPath,
    expectedOperationalIdentityId: operationalIdentityId,
  });
  const {
    permissions,
  } = await readPermissionDefinitions({
    operationalIdentityRootPath,
    expectedOperationalIdentityId: operationalIdentityId,
  });
  const resolvedBindingResult = resolveBindingsForInvocation({
    bindingDefinitions: bindings,
    resourceRegistry: registry,
    operationalIdentityId,
  });
  const resolvedPermissionEvaluation = evaluatePermissionsForInvocation({
    resolvedBindings: resolvedBindingResult.resolvedBindings,
    permissionDefinitions: permissions,
  });

  return {
    resolvedBindings: resolvedBindingResult.resolvedBindings,
    permissionEvaluation: resolvedPermissionEvaluation,
    warnings: resolvedBindingResult.warnings,
  };
}

async function resolveToolRuntime({
  masRootPath,
  operationalIdentityId,
  toolDefinitions,
  resolvedBindings,
  permissionEvaluation,
  secretResolution,
}) {
  const toolRegistry = Array.isArray(toolDefinitions)
    ? {
      toolDefinitions,
      warnings: [],
    }
    : await readToolDefinitions({
      masRootPath,
    });
  const operationalRuntime = await resolveOperationalRuntime({
    masRootPath,
    operationalIdentityId,
    resolvedBindings,
    permissionEvaluation,
  });
  const toolReadinessEvaluation = evaluateToolReadinessForInvocation({
    toolDefinitions: toolRegistry.toolDefinitions,
    resolvedBindings: operationalRuntime.resolvedBindings,
    permissionEvaluation: operationalRuntime.permissionEvaluation,
    secretResolution,
  });

  return {
    toolDefinitions: toolRegistry.toolDefinitions,
    toolDefinitionsById: createMapById(toolRegistry.toolDefinitions, 'toolId'),
    resolvedBindings: operationalRuntime.resolvedBindings,
    permissionEvaluation: operationalRuntime.permissionEvaluation,
    toolReadinessEvaluation,
    warnings: [
      ...toolRegistry.warnings,
      ...operationalRuntime.warnings,
      ...toolReadinessEvaluation.warnings,
    ],
  };
}

function transitionWorkflowState({
  state,
  updates,
  updatedAt = new Date().toISOString(),
}) {
  return assertWorkflowRunState({
    ...state,
    ...updates,
    updatedAt,
  });
}

async function persistWorkflowStateIfNeeded({
  masRootPath,
  workflowRunState,
  shouldPersistState,
  statePersistenceRecords,
}) {
  if (!shouldPersistState) {
    return null;
  }

  const persistence = await writeWorkflowRunState({
    masRootPath,
    workflowRunState,
  });

  statePersistenceRecords.push({
    status: workflowRunState.status,
    currentStepId: workflowRunState.currentStepId,
    workflowRunStateRecordPath: persistence.workflowRunStateRecordPath,
  });

  return persistence;
}

function buildFailedStepResult({
  step,
  reason,
}) {
  return {
    stepId: step.stepId,
    stepType: step.stepType,
    toolId: step.toolId ?? null,
    status: 'failed',
    reason,
    toolDefinition: null,
    toolResult: null,
    toolPersistence: null,
  };
}

async function executeToolCallStep({
  masRootPath,
  step,
  toolRuntime,
  invocationId,
  operationalIdentityId,
  requestedBy,
}) {
  const toolDefinition = toolRuntime.toolDefinitionsById.get(step.toolId) ?? null;

  if (!toolDefinition) {
    return buildFailedStepResult({
      step,
      reason: `Workflow step ${step.stepId} references an unknown tool: ${step.toolId}.`,
    });
  }

  const readinessVerdict = findToolReadinessVerdict({
    toolReadinessEvaluation: toolRuntime.toolReadinessEvaluation,
    toolId: step.toolId,
  });

  if (!readinessVerdict) {
    return buildFailedStepResult({
      step,
      reason: `Workflow step ${step.stepId} has no readiness verdict for tool ${step.toolId}.`,
    });
  }

  if (readinessVerdict.status === 'approval_required') {
    return {
      stepId: step.stepId,
      stepType: step.stepType,
      toolId: step.toolId,
      status: 'approval_required',
      reason: readinessVerdict.reason,
      approvalRequestId: null,
      toolReadinessVerdict: readinessVerdict,
      toolDefinition,
      toolResult: null,
      toolPersistence: null,
    };
  }

  if (readinessVerdict.status !== 'ready') {
    return buildFailedStepResult({
      step,
      reason: readinessVerdict.reason,
    });
  }

  const toolResult = await executeLocalReadOnlyToolForInvocation({
    masRootPath,
    toolDefinition,
    readinessVerdict,
    input: step.input,
    invocationId,
    operationalIdentityId,
    requestedBy,
  });
  const toolPersistence = await persistToolResultForInvocation({
    masRootPath,
    toolDefinition,
    toolResult,
  });

  return {
    stepId: step.stepId,
    stepType: step.stepType,
    toolId: step.toolId,
    status: toolResult.status === 'succeeded' ? 'succeeded' : 'failed',
    reason: toolResult.summary,
    toolReadinessVerdict: readinessVerdict,
    toolDefinition,
    toolResult,
    toolPersistence,
  };
}

async function executeWorkflowStep({
  masRootPath,
  step,
  toolRuntime,
  invocationId,
  operationalIdentityId,
  requestedBy,
}) {
  if (step.stepType === 'tool_call') {
    return executeToolCallStep({
      masRootPath,
      step,
      toolRuntime,
      invocationId,
      operationalIdentityId,
      requestedBy,
    });
  }

  return buildFailedStepResult({
    step,
    reason: `Workflow step type "${step.stepType}" is not executable by Workflow Runner v1.`,
  });
}

function applyStepFailurePolicy({
  state,
  step,
  stepResult,
  errors,
  warnings,
}) {
  const toolEvidenceUpdates = collectToolEvidenceStateUpdates({
    state,
    stepResult,
  });

  if (step.onFailure === 'pause_workflow') {
    warnings.push(`Workflow paused at step ${step.stepId}: ${stepResult.reason}`);

    return transitionWorkflowState({
      state,
      updates: {
        ...toolEvidenceUpdates,
        status: 'waiting_for_external_event',
        currentStepId: step.stepId,
        blockedSteps: uniqueStrings([...state.blockedSteps, step.stepId]),
        warnings: uniqueStrings([...state.warnings, ...warnings]),
      },
    });
  }

  if (step.onFailure === 'skip_step' || step.onFailure === 'continue') {
    warnings.push(`Workflow continued after step ${step.stepId} failed: ${stepResult.reason}`);

    return transitionWorkflowState({
      state,
      updates: {
        ...toolEvidenceUpdates,
        status: 'running',
        completedSteps: uniqueStrings([...state.completedSteps, step.stepId]),
        warnings: uniqueStrings([...state.warnings, ...warnings]),
      },
    });
  }

  errors.push(stepResult.reason);

  return transitionWorkflowState({
    state,
    updates: {
      ...toolEvidenceUpdates,
      status: 'failed',
      currentStepId: null,
      failedSteps: uniqueStrings([...state.failedSteps, step.stepId]),
      warnings: uniqueStrings([...state.warnings, ...warnings]),
    },
  });
}

function applyApprovalRequiredStep({
  state,
  step,
  workflowRunId,
  stepResult,
  warnings,
}) {
  const approvalRequestId = createWorkflowApprovalRequestId({
    workflowRunId,
    stepId: step.stepId,
  });

  stepResult.approvalRequestId = approvalRequestId;
  warnings.push(`Workflow step ${step.stepId} requires human approval before execution: ${stepResult.reason}`);

  return transitionWorkflowState({
    state,
    updates: {
      status: 'waiting_for_approval',
      currentStepId: step.stepId,
      blockedSteps: uniqueStrings([...state.blockedSteps, step.stepId]),
      approvalRequests: uniqueStrings([...state.approvalRequests, approvalRequestId]),
      warnings: uniqueStrings([...state.warnings, ...warnings]),
    },
  });
}

function applySucceededToolStep({
  state,
  step,
  stepResult,
}) {
  const toolEvidenceUpdates = collectToolEvidenceStateUpdates({
    state,
    stepResult,
  });

  return transitionWorkflowState({
    state,
    updates: {
      ...toolEvidenceUpdates,
      status: 'running',
      currentStepId: step.stepId,
      completedSteps: uniqueStrings([...state.completedSteps, step.stepId]),
    },
  });
}

function collectToolEvidenceStateUpdates({
  state,
  stepResult,
}) {
  if (!stepResult.toolResult) {
    return {};
  }

  return {
    toolRunIds: uniqueStrings([...state.toolRunIds, stepResult.toolResult.toolRunId]),
    artifactReferences: stepResult.toolPersistence
      ? mergeArtifactReferences({
        currentReferences: state.artifactReferences,
        nextReferences: stepResult.toolPersistence.auditRecord.artifactReferences,
      })
      : state.artifactReferences,
    memoryWritebackCandidateIds: uniqueStrings([
      ...state.memoryWritebackCandidateIds,
      ...stepResult.toolResult.memoryWritebackCandidates.map((candidate) => candidate.writeId),
    ]),
  };
}

export async function runWorkflow({
  masRootPath,
  workflowId,
  workflowRuntimeDefinition = null,
  workflowRunId = null,
  operationalIdentityId,
  invocationId = crypto.randomUUID(),
  requestedBy,
  toolDefinitions = null,
  resolvedBindings = null,
  permissionEvaluation = null,
  secretResolution = null,
  persistState = true,
} = {}) {
  const normalizedMasRootPath = assertNonEmptyString(masRootPath, 'Workflow runner masRootPath');
  const normalizedOperationalIdentityId = assertNonEmptyString(
    operationalIdentityId,
    'Workflow runner operationalIdentityId',
  );
  const normalizedInvocationId = assertNonEmptyString(invocationId, 'Workflow runner invocationId');
  const normalizedRequestedBy = assertNonEmptyString(requestedBy, 'Workflow runner requestedBy');
  const {
    workflowRuntimeDefinition: definition,
    warnings: workflowDefinitionWarnings,
  } = await resolveWorkflowDefinition({
    masRootPath: normalizedMasRootPath,
    workflowId,
    workflowRuntimeDefinition,
  });

  if (definition.lifecycleState !== 'active') {
    throw new Error(`Workflow ${definition.workflowId} cannot run because lifecycleState is not active: ${definition.lifecycleState}.`);
  }

  const shouldPersistState = persistState && definition.statePolicy.persistState;
  const statePersistenceRecords = [];
  const warnings = [...workflowDefinitionWarnings];
  const errors = [];
  const stepResults = [];
  const toolRuntime = await resolveToolRuntime({
    masRootPath: normalizedMasRootPath,
    operationalIdentityId: normalizedOperationalIdentityId,
    toolDefinitions,
    resolvedBindings,
    permissionEvaluation,
    secretResolution,
  });

  warnings.push(...toolRuntime.warnings);

  let state = createWorkflowRunState({
    workflowRuntimeDefinition: definition,
    workflowRunId,
    operationalIdentityId: normalizedOperationalIdentityId,
    invocationId: normalizedInvocationId,
  });
  let finalPersistence = await persistWorkflowStateIfNeeded({
    masRootPath: normalizedMasRootPath,
    workflowRunState: state,
    shouldPersistState,
    statePersistenceRecords,
  });

  state = transitionWorkflowState({
    state,
    updates: {
      status: 'running',
    },
  });
  finalPersistence = await persistWorkflowStateIfNeeded({
    masRootPath: normalizedMasRootPath,
    workflowRunState: state,
    shouldPersistState,
    statePersistenceRecords,
  });

  while (state.status === 'running') {
    if (allStepsCompleted({
      workflowRuntimeDefinition: definition,
      completedSteps: state.completedSteps,
    })) {
      state = transitionWorkflowState({
        state,
        updates: {
          status: 'succeeded',
          currentStepId: null,
          warnings: uniqueStrings([...state.warnings, ...warnings]),
        },
      });
      finalPersistence = await persistWorkflowStateIfNeeded({
        masRootPath: normalizedMasRootPath,
        workflowRunState: state,
        shouldPersistState,
        statePersistenceRecords,
      });
      break;
    }

    const nextStep = resolveNextEligibleStep({
      workflowRuntimeDefinition: definition,
      completedSteps: state.completedSteps,
    });

    if (!nextStep) {
      errors.push('Workflow runner could not resolve the next eligible step.');
      state = transitionWorkflowState({
        state,
        updates: {
          status: 'failed',
          currentStepId: null,
          warnings: uniqueStrings([...state.warnings, ...warnings]),
        },
      });
      finalPersistence = await persistWorkflowStateIfNeeded({
        masRootPath: normalizedMasRootPath,
        workflowRunState: state,
        shouldPersistState,
        statePersistenceRecords,
      });
      break;
    }

    state = transitionWorkflowState({
      state,
      updates: {
        status: 'running',
        currentStepId: nextStep.stepId,
      },
    });
    finalPersistence = await persistWorkflowStateIfNeeded({
      masRootPath: normalizedMasRootPath,
      workflowRunState: state,
      shouldPersistState,
      statePersistenceRecords,
    });

    const stepResult = await executeWorkflowStep({
      masRootPath: normalizedMasRootPath,
      step: nextStep,
      toolRuntime,
      invocationId: normalizedInvocationId,
      operationalIdentityId: normalizedOperationalIdentityId,
      requestedBy: normalizedRequestedBy,
    });

    stepResults.push(stepResult);

    if (stepResult.status === 'approval_required') {
      state = applyApprovalRequiredStep({
        state,
        step: nextStep,
        workflowRunId: state.workflowRunId,
        stepResult,
        warnings,
      });
      finalPersistence = await persistWorkflowStateIfNeeded({
        masRootPath: normalizedMasRootPath,
        workflowRunState: state,
        shouldPersistState,
        statePersistenceRecords,
      });
      break;
    }

    if (stepResult.status !== 'succeeded') {
      state = applyStepFailurePolicy({
        state,
        step: nextStep,
        stepResult,
        errors,
        warnings,
      });
      finalPersistence = await persistWorkflowStateIfNeeded({
        masRootPath: normalizedMasRootPath,
        workflowRunState: state,
        shouldPersistState,
        statePersistenceRecords,
      });
      continue;
    }

    state = applySucceededToolStep({
      state,
      step: nextStep,
      stepResult,
    });
    finalPersistence = await persistWorkflowStateIfNeeded({
      masRootPath: normalizedMasRootPath,
      workflowRunState: state,
      shouldPersistState,
      statePersistenceRecords,
    });
  }

  let workflowRunResult = {
    kind: 'workflow_run_result',
    version: 1,
    workflowRunId: state.workflowRunId,
    workflowId: state.workflowId,
    status: state.status,
    workflowRuntimeDefinition: definition,
    workflowRunState: state,
    stepResults,
    toolReadiness: toolRuntime.toolReadinessEvaluation,
    persistence: finalPersistence,
    statePersistenceRecords,
    memoryWritebackRequest: null,
    memoryWritebackPersistence: null,
    warnings: uniqueStrings([...warnings, ...state.warnings]),
    errors: uniqueStrings(errors),
  };

  const memoryWritebackRequest = proposeMemoryWritebackForWorkflowRun({
    workflowRunResult,
    requestedBy: normalizedRequestedBy,
  });
  let memoryWritebackPersistence = null;

  if (memoryWritebackRequest.memoryWrites.length > 0) {
    state = transitionWorkflowState({
      state,
      updates: {
        memoryWritebackCandidateIds: uniqueStrings([
          ...state.memoryWritebackCandidateIds,
          ...memoryWritebackRequest.memoryWrites.map((candidate) => candidate.writeId),
        ]),
      },
    });
    finalPersistence = await persistWorkflowStateIfNeeded({
      masRootPath: normalizedMasRootPath,
      workflowRunState: state,
      shouldPersistState,
      statePersistenceRecords,
    });
    memoryWritebackPersistence = await writeMemoryWritebackRequest({
      masRootPath: normalizedMasRootPath,
      memoryWritebackRequest,
      recordId: state.workflowRunId,
    });
  }

  workflowRunResult = {
    ...workflowRunResult,
    status: state.status,
    workflowRunState: state,
    persistence: finalPersistence,
    statePersistenceRecords,
    memoryWritebackRequest,
    memoryWritebackPersistence,
    warnings: uniqueStrings([
      ...workflowRunResult.warnings,
      ...memoryWritebackRequest.warnings,
      ...state.warnings,
    ]),
  };

  return workflowRunResult;
}
