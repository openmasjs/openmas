import { randomUUID } from 'node:crypto';
import { createAgentInvocationRequest } from '../contracts/identity/agent-invocation-contract.js';
import { assertAgentExecutionResult } from '../contracts/identity/agent-execution-contract.js';
import { runSystemBoot } from '../boot/run-system-boot.js';
import { prepareAgentInvocation } from './prepare-agent-invocation.js';
import { writeInvocationArtifacts } from './write-invocation-artifacts.js';
import { executeMasOwnedDeterministicCommand } from './execute-mas-owned-deterministic-command.js';
import { runProbabilisticAgentInvocation } from './run-probabilistic-agent-invocation.js';
import { writeHumanApprovalRuntimeArtifacts } from '../approvals/write-human-approval-runtime-artifacts.js';
import { createConversationSession } from '../conversations/create-conversation-session.js';
import { resolveConversationReference } from '../conversations/resolve-conversation-reference.js';
import { writeConversationTurn } from '../conversations/write-conversation-turn.js';
import { buildInvocationNextStep } from './build-invocation-next-step.js';
import { buildAgentWorkCycleSummary } from './build-agent-work-cycle-summary.js';
import { buildRuntimeWarningRelevance } from '../warnings/runtime-warning-relevance.js';
import {
  buildProviderHealthReportSection,
  buildProviderHealthSnapshotsForInvocation,
} from '../providers/build-provider-health-snapshots-for-invocation.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values) {
  const seenValues = new Set();
  const normalizedValues = [];

  for (const value of values) {
    if (!isNonEmptyString(value)) {
      continue;
    }

    const normalizedValue = value.trim();

    if (seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    normalizedValues.push(normalizedValue);
  }

  return normalizedValues;
}

function getProbabilisticBlockReason({ readiness }) {
  if (!readiness.operationalIdentityDefinition) {
    return 'Probabilistic invocation requires an Operational Identity with a configured brain.';
  }

  const selectedBrainProvider = readiness.providerPreparation?.selectedBrainProvider ?? null;
  const fallbackBrainProvider = readiness.providerPreparation?.fallbackBrainProvider ?? null;

  const selectedProviderIsReady = selectedBrainProvider?.status === 'ready';
  const fallbackProviderIsReady = fallbackBrainProvider?.status === 'ready';

  if (selectedProviderIsReady || fallbackProviderIsReady) {
    return null;
  }

  if (selectedBrainProvider) {
    return selectedBrainProvider.reason;
  }

  if (fallbackBrainProvider) {
    return fallbackBrainProvider.reason;
  }

  return 'Probabilistic invocation requires at least one ready brain provider.';
}

function buildHumanConversationTurn({ request }) {
  const contentText = request.inputText && request.inputText.trim().length > 0
    ? request.inputText.trim()
    : `Command: ${request.command}`;

  return {
    role: 'human',
    speaker: {
      speakerType: 'human',
      speakerId: request.requestedBy,
      displayName: request.requestedBy,
    },
    content: {
      contentType: 'text',
      text: contentText,
    },
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
  };
}

function resolveAgentConversationText({
  executionStatus,
  executionOutcome,
  brainOutput,
}) {
  if (executionStatus !== 'completed') {
    return null;
  }

  if (brainOutput?.outputText && brainOutput.outputText.trim().length > 0) {
    return brainOutput.outputText.trim();
  }

  return executionOutcome.message;
}

function buildOperationalIdentityConversationTurn({
  readiness,
  invocationId,
  text,
}) {
  return {
    role: 'operational_identity',
    speaker: {
      speakerType: 'operational_identity',
      speakerId: readiness.operationalIdentityDefinition.operationalIdentityId,
      displayName: readiness.operationalIdentityDefinition.displayName,
    },
    content: {
      contentType: 'markdown',
      text,
    },
    invocationId,
    runtimeReferences: [
      {
        referenceType: 'invocation',
        referenceId: invocationId,
      },
    ],
    privacy: {
      visibility: 'private_to_conversation',
      sensitivityLevel: 'internal',
    },
  };
}

function summarizeConversationRuntime({
  conversationContext,
  humanTurnPersistence,
  agentTurnPersistence,
}) {
  if (!conversationContext) {
    return null;
  }

  return {
    conversationRef: conversationContext.conversationRef,
    conversationId: conversationContext.conversationId,
    resolutionType: conversationContext.resolutionType,
    humanTurnId: humanTurnPersistence?.turn?.turnId ?? null,
    agentTurnId: agentTurnPersistence?.turn?.turnId ?? null,
    relativeSessionPath: agentTurnPersistence?.relativeSessionPath
      ?? humanTurnPersistence?.relativeSessionPath
      ?? `memory/state/conversations/${conversationContext.conversationId}/session.json`,
    relativeTurnsPath: agentTurnPersistence?.relativeTurnsPath
      ?? humanTurnPersistence?.relativeTurnsPath
      ?? `memory/state/conversations/${conversationContext.conversationId}/turns.json`,
  };
}

function shouldCreateConversationOnly(request) {
  return (
    request.invocationMode === 'deterministic'
    && request.command === 'status'
    && request.inputText.trim().length === 0
  );
}

function buildCreatedConversationContext({
  conversationPersistence,
  conversationRef,
}) {
  return {
    conversationRef,
    conversationId: conversationPersistence.conversationId,
    resolutionType: 'created_conversation',
    session: conversationPersistence.session,
    totalTurnCount: 0,
    sessionRecordPath: conversationPersistence.sessionRecordPath,
    turnsRecordPath: conversationPersistence.turnsRecordPath,
  };
}

function buildWarningRelevanceForInvocation({
  warnings,
  request,
  readiness = null,
  output = null,
  actionResolution = null,
  toolRequestResolution = null,
  brainToolExecution = null,
  brainToolObservation = null,
  workflowRequestResolution = null,
  brainWorkflowExecution = null,
  brainWorkflowObservation = null,
  semanticIntentRuntime = null,
  actionClaimGuard = null,
  verificationGate = null,
  actionResultAssessment = null,
  humanApprovalRuntime = null,
}) {
  return buildRuntimeWarningRelevance(warnings, {
    runtimeContext: {
      request,
      readiness,
      output,
      actionResolution,
      toolRequestResolution,
      brainToolExecution,
      brainToolObservation,
      workflowRequestResolution,
      brainWorkflowExecution,
      brainWorkflowObservation,
      semanticIntentRuntime,
      actionClaimGuard,
      verificationGate,
      actionResultAssessment,
      humanApprovalRuntime,
    },
  });
}

export async function runAgentInvocation(options = {}) {
  const invocationId = randomUUID();
  const startedAt = new Date().toISOString();
  const normalizedRequest = createAgentInvocationRequest({
    ...options,
    invocationMode: options.invocationMode ?? 'deterministic',
  });

  try {
    const bootResult = await runSystemBoot({
      projectRootPath: options.projectRootPath,
      masRootHint: options.masRootHint,
      strict: options.strict,
      requestedBy: normalizedRequest.requestedBy,
    });

    const readiness = await prepareAgentInvocation({
      bootResult,
      request: normalizedRequest,
    });

    if (readiness.status !== 'ready') {
      const executionStatus = readiness.status === 'blocked' ? 'blocked' : 'failed';
      const warningRelevance = buildWarningRelevanceForInvocation({
        warnings: readiness.warnings,
        request: normalizedRequest,
        readiness,
      });
      const nextStep = buildInvocationNextStep({
        status: executionStatus,
        request: normalizedRequest,
      });
      const workCycle = buildAgentWorkCycleSummary({
        invocationId,
        primaryCognitiveIdentityId: readiness.resolvedPrimaryCognitiveIdentityId ?? null,
        operationalIdentityId: normalizedRequest.operationalIdentityId,
        request: normalizedRequest,
        executionStatus,
        readiness,
        message: readiness.errors[0] ?? 'The agent invocation could not proceed.',
        nextStep,
        persistenceCompleted: false,
      });

      return assertAgentExecutionResult({
        invocationId,
        primaryCognitiveIdentityId: readiness.resolvedPrimaryCognitiveIdentityId ?? null,
        operationalIdentityId: normalizedRequest.operationalIdentityId,
        status: executionStatus,
        request: normalizedRequest,
        bootResult,
        readiness,
        message: readiness.errors[0] ?? 'The agent invocation could not proceed.',
        warnings: readiness.warnings,
        warningRelevance,
        errors: readiness.errors,
        nextStep,
        startedAt,
        finishedAt: new Date().toISOString(),
        persistence: null,
        output: null,
        workCycle,
        executionPlan: null,
      });
    }

    const primaryCognitiveIdentityId = readiness.resolvedPrimaryCognitiveIdentityId;

    let createdConversationPersistence = null;
    let conversationWasCreatedForInvocation = false;

    if (normalizedRequest.createConversationName) {
      if (!normalizedRequest.operationalIdentityId || !readiness.operationalIdentityDefinition) {
        throw new Error('Conversation creation requires an Operational Identity target.');
      }

      createdConversationPersistence = await createConversationSession({
        masRootPath: bootResult.masRootPath,
        conversationId: normalizedRequest.createConversationName,
        title: normalizedRequest.createConversationName,
        ownerOperationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
        humanParticipantIds: [normalizedRequest.requestedBy],
        createdBy: normalizedRequest.requestedBy,
        createdAt: startedAt,
      });

      if (shouldCreateConversationOnly(normalizedRequest)) {
        const warningRelevance = buildWarningRelevanceForInvocation({
          warnings: readiness.warnings,
          request: normalizedRequest,
          readiness,
          output: {
            executionType: 'conversation_creation',
            conversationId: createdConversationPersistence.conversationId,
          },
        });
        const nextStep = `Resume it with --conversation ${createdConversationPersistence.conversationId}.`;
        const workCycle = buildAgentWorkCycleSummary({
          invocationId,
          primaryCognitiveIdentityId,
          operationalIdentityId: normalizedRequest.operationalIdentityId,
          request: normalizedRequest,
          executionStatus: 'completed',
          executionType: 'conversation_creation',
          readiness,
          message: `Conversation ${createdConversationPersistence.conversationId} was created for ${readiness.operationalIdentityDefinition.displayName}.`,
          nextStep,
          conversationRuntime: {
            conversationId: createdConversationPersistence.conversationId,
          },
          persistenceCompleted: false,
        });

        return assertAgentExecutionResult({
          invocationId,
          primaryCognitiveIdentityId,
          operationalIdentityId: normalizedRequest.operationalIdentityId,
          status: 'completed',
          request: normalizedRequest,
          bootResult,
          readiness,
          message: `Conversation ${createdConversationPersistence.conversationId} was created for ${readiness.operationalIdentityDefinition.displayName}.`,
          warnings: readiness.warnings,
          warningRelevance,
          errors: [],
          nextStep,
          startedAt,
          finishedAt: new Date().toISOString(),
          persistence: null,
          conversation: {
            conversationId: createdConversationPersistence.conversationId,
            created: true,
            relativeSessionPath: createdConversationPersistence.relativeSessionPath,
            relativeTurnsPath: createdConversationPersistence.relativeTurnsPath,
          },
          output: {
            executionType: 'conversation_creation',
            conversationId: createdConversationPersistence.conversationId,
            title: createdConversationPersistence.session.title,
            relativeSessionPath: createdConversationPersistence.relativeSessionPath,
            relativeTurnsPath: createdConversationPersistence.relativeTurnsPath,
          },
          workCycle,
          executionPlan: null,
        });
      }

      conversationWasCreatedForInvocation = true;
    }

    let requestForExecution = normalizedRequest;
    let conversationContext = null;
    let humanTurnPersistence = null;

    if (createdConversationPersistence) {
      conversationContext = buildCreatedConversationContext({
        conversationPersistence: createdConversationPersistence,
        conversationRef: normalizedRequest.createConversationName,
      });
      humanTurnPersistence = await writeConversationTurn({
        masRootPath: bootResult.masRootPath,
        conversationId: conversationContext.conversationId,
        requesterOperationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
        turn: buildHumanConversationTurn({
          request: normalizedRequest,
        }),
        createdAt: new Date().toISOString(),
      });
      requestForExecution = createAgentInvocationRequest({
        ...normalizedRequest,
        createConversationName: null,
        conversationId: conversationContext.conversationId,
      });
    } else if (normalizedRequest.conversationRef) {
      if (!normalizedRequest.operationalIdentityId || !readiness.operationalIdentityDefinition) {
        throw new Error('Conversation invocation requires an Operational Identity target.');
      }

      conversationContext = await resolveConversationReference({
        masRootPath: bootResult.masRootPath,
        conversationRef: normalizedRequest.conversationRef,
        requesterOperationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
      });
      humanTurnPersistence = await writeConversationTurn({
        masRootPath: bootResult.masRootPath,
        conversationId: conversationContext.conversationId,
        requesterOperationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
        turn: buildHumanConversationTurn({
          request: normalizedRequest,
        }),
        createdAt: new Date().toISOString(),
      });
      requestForExecution = createAgentInvocationRequest({
        ...normalizedRequest,
        conversationId: conversationContext.conversationId,
      });
    }

    const executionReadiness = {
      ...readiness,
      conversationContext,
      usableBindings: readiness.usableBindings ?? [],
      resolvedBindings: {
        resolvedBindings: readiness.usableBindings ?? [],
        warnings: readiness.resolvedBindings?.warnings ?? [],
      },
      secretResolution: readiness.secretResolution ?? null,
      providerPreparation: readiness.providerPreparation ?? null,
    };

    if (requestForExecution.invocationMode === 'probabilistic') {
      const probabilisticBlockReason = getProbabilisticBlockReason({
        readiness: executionReadiness,
      });

      if (probabilisticBlockReason) {
        const warningRelevance = buildWarningRelevanceForInvocation({
          warnings: readiness.warnings,
          request: requestForExecution,
          readiness: executionReadiness,
        });
        const nextStep = buildInvocationNextStep({
          status: 'blocked',
          request: requestForExecution,
        });
        const workCycle = buildAgentWorkCycleSummary({
          invocationId,
          primaryCognitiveIdentityId,
          operationalIdentityId: normalizedRequest.operationalIdentityId,
          request: requestForExecution,
          executionStatus: 'blocked',
          readiness: executionReadiness,
          message: probabilisticBlockReason,
          nextStep,
          persistenceCompleted: false,
        });

        return assertAgentExecutionResult({
          invocationId,
          primaryCognitiveIdentityId,
          operationalIdentityId: normalizedRequest.operationalIdentityId,
          status: 'blocked',
          request: requestForExecution,
          bootResult,
          readiness,
          message: probabilisticBlockReason,
          warnings: readiness.warnings,
          warningRelevance,
          errors: [probabilisticBlockReason],
          nextStep,
          startedAt,
          finishedAt: new Date().toISOString(),
          persistence: null,
          output: null,
          workCycle,
          executionPlan: null,
        });
      }
    }

    const executionResult = requestForExecution.invocationMode === 'probabilistic'
      ? await runProbabilisticAgentInvocation({
        invocationId,
        bootResult,
        readiness: executionReadiness,
        request: requestForExecution,
        fetchImplementation: options.fetchImplementation,
        providerRetryPolicy: options.providerRetryPolicy ?? null,
        semanticIntentRuntimeMode: options.semanticIntentRuntimeMode ?? 'disabled',
        semanticIntentClassifierAdapter: options.semanticIntentClassifierAdapter ?? null,
        semanticIntentClassifierId: options.semanticIntentClassifierId ?? 'semantic-intent-runtime-classifier',
      })
      : {
        ...(await executeMasOwnedDeterministicCommand({
          cognitiveIdentityRootPath: readiness.resolvedCognitiveIdentity.cognitiveIdentityRootPath,
          commandName: requestForExecution.command,
          bootResult,
          readiness: executionReadiness,
          request: requestForExecution,
        })),
        executionStatus: 'completed',
        brainExecution: null,
        brainInputSummary: null,
        providerRequestSummary: null,
        instructionLayerSummary: null,
        promptProfileSelection: null,
        promptBudgetReport: null,
        promptProvenance: null,
        brainOutput: null,
        providerResponse: null,
        intentResolution: null,
        actionResolution: null,
        toolRequestResolution: null,
        executedBrainToolRequest: null,
        brainToolExecution: null,
        brainToolObservation: null,
        workflowRequestResolution: null,
        executedBrainWorkflowRequest: null,
        brainWorkflowExecution: null,
        brainWorkflowObservation: null,
        semanticIntentRuntime: null,
        actionClaimGuard: null,
        verificationGate: null,
        actionResultAssessment: null,
        humanApprovalRuntime: null,
        executionPlan: null,
      };

    const {
      commandModulePath,
      executionOutcome,
      executionStatus,
      brainExecution,
      fallbackDecisionTrace,
      brainInputSummary,
      providerRequestSummary,
      instructionLayerSummary,
      promptProfileSelection,
      promptBudgetReport,
      promptProvenance,
      brainOutput,
      providerResponse,
      intentResolution,
      actionResolution,
      toolRequestResolution,
      executedBrainToolRequest,
      brainToolExecution,
      brainToolObservation,
      workflowRequestResolution,
      executedBrainWorkflowRequest,
      brainWorkflowExecution,
      brainWorkflowObservation,
      semanticIntentRuntime,
      actionClaimGuard,
      verificationGate,
      actionResultAssessment,
      humanApprovalRuntime,
      executionPlan,
      planExecutionCoordination,
    } = executionResult;

    const agentConversationText = resolveAgentConversationText({
      executionStatus,
      executionOutcome,
      brainOutput,
    });
    const agentTurnPersistence = conversationContext && agentConversationText
      ? await writeConversationTurn({
        masRootPath: bootResult.masRootPath,
        conversationId: conversationContext.conversationId,
        requesterOperationalIdentityId: readiness.operationalIdentityDefinition.operationalIdentityId,
        turn: buildOperationalIdentityConversationTurn({
          readiness,
          invocationId,
          text: agentConversationText,
        }),
        createdAt: new Date().toISOString(),
      })
      : null;
    const conversationRuntime = summarizeConversationRuntime({
      conversationContext,
      humanTurnPersistence,
      agentTurnPersistence,
    });

    if (conversationRuntime) {
      conversationRuntime.created = conversationWasCreatedForInvocation;
    }
    const finishedAt = new Date().toISOString();
    const providerHealth = await buildProviderHealthSnapshotsForInvocation({
      masRootPath: bootResult.masRootPath,
      invocationId,
      startedAt,
      finishedAt,
      providerPreparation: readiness.providerPreparation ?? null,
      brainExecution,
      semanticIntentRuntime,
    });
    const providerHealthReportSection = buildProviderHealthReportSection(providerHealth);
    const reportContent = providerHealthReportSection
      ? `${executionOutcome.reportContent}\n\n${providerHealthReportSection}`
      : executionOutcome.reportContent;
    const outputPayload = executionOutcome.outputPayload
      ? {
          ...executionOutcome.outputPayload,
          providerHealth,
        }
      : null;
    const humanApprovalPersistence = await writeHumanApprovalRuntimeArtifacts({
      masRootPath: bootResult.masRootPath,
      approvalRuntime: humanApprovalRuntime,
    });
    const runtimeWarnings = uniqueStrings([
      ...readiness.warnings,
      ...(brainOutput?.warnings ?? []),
      ...(brainToolExecution?.warnings ?? []),
      ...(brainWorkflowExecution?.warnings ?? []),
      ...(semanticIntentRuntime?.warnings ?? []),
      ...(actionClaimGuard?.warnings ?? []),
      ...(verificationGate?.warnings ?? []),
      ...(actionResultAssessment?.warnings ?? []),
    ]);
    const warningRelevance = buildWarningRelevanceForInvocation({
      warnings: runtimeWarnings,
      request: requestForExecution,
      readiness: executionReadiness,
      output: executionOutcome.outputPayload,
      actionResolution,
      toolRequestResolution,
      brainToolExecution,
      brainToolObservation,
      workflowRequestResolution,
      brainWorkflowExecution,
      brainWorkflowObservation,
      semanticIntentRuntime,
      actionClaimGuard,
      verificationGate,
      actionResultAssessment,
      humanApprovalRuntime,
      planExecutionCoordination,
    });
    const nextStep = buildInvocationNextStep({
      status: executionStatus,
      request: requestForExecution,
      conversationRuntime,
      readiness: executionReadiness,
      brainOutput,
      brainExecution,
      fallbackDecisionTrace,
      toolRequestResolution,
      brainToolExecution,
      workflowRequestResolution,
      brainWorkflowExecution,
      semanticIntentRuntime,
      actionResultAssessment,
      humanApprovalRuntime,
    });
    const workCycle = buildAgentWorkCycleSummary({
      invocationId,
      primaryCognitiveIdentityId,
      operationalIdentityId: normalizedRequest.operationalIdentityId,
      request: requestForExecution,
      executionStatus,
      executionType: requestForExecution.invocationMode === 'probabilistic'
        ? 'probabilistic_brain'
        : 'deterministic_command',
      readiness: executionReadiness,
      actionResolution,
      toolRequestResolution,
      workflowRequestResolution,
      brainToolExecution,
      brainToolObservation,
      brainWorkflowExecution,
      brainWorkflowObservation,
      semanticIntentRuntime,
      actionResultAssessment,
      verificationGate,
      humanApprovalRuntime,
      executionPlan,
      message: executionOutcome.message,
      nextStep,
      conversationRuntime,
      persistenceCompleted: true,
    });
    const invocationSession = {
      kind: 'agent_invocation_session',
      invocationId,
      operationalIdentityId: normalizedRequest.operationalIdentityId,
      operationalDisplayName: readiness.operationalIdentityDefinition?.displayName ?? null,
      auditActorId: readiness.auditActorId ?? null,
      primaryCognitiveIdentityId,
      secondaryCognitiveIdentityIds: readiness.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? [],
      activeCognitiveSetResolutionSource: readiness.activeCognitiveSet?.resolutionSource ?? null,
      executionProfileId: readiness.executionProfileDefinition?.executionProfileId ?? null,
      executionMode: readiness.executionProfileDefinition?.executionMode ?? null,
      selectedBrain: readiness.brainSelection?.selectedBrain ?? null,
      fallbackBrain: readiness.brainSelection?.fallbackBrain ?? null,
      brainSelectionSource: readiness.brainSelection?.selectionSource ?? null,
      brainRequired: readiness.brainSelection?.brainRequired ?? false,
      resolvedBindings: readiness.resolvedBindings?.resolvedBindings ?? [],
      usableBindings: readiness.usableBindings ?? [],
      permissionEvaluation: readiness.permissionEvaluation ?? null,
      secretResolution: readiness.secretResolution
        ? {
          resolvedCredentialReferences: readiness.secretResolution.resolvedCredentialReferences,
          summary: readiness.secretResolution.summary,
          warnings: readiness.secretResolution.warnings,
          credentialVaultEnvironment: readiness.secretResolution.credentialVaultEnvironment,
          credentialVaultExists: readiness.secretResolution.credentialVaultExists,
        }
        : null,
      providerPreparation: readiness.providerPreparation ?? null,
      toolReadiness: readiness.toolReadiness ?? null,
      executionType: requestForExecution.invocationMode === 'probabilistic'
        ? 'probabilistic_brain'
        : 'deterministic_command',
      brainExecution,
      fallbackDecisionTrace,
      brainInputSummary,
      providerRequestSummary,
      instructionLayerSummary,
      promptProfileSelection,
      promptBudgetReport,
      promptProvenance,
      brainOutput,
      providerResponse,
      intentResolution,
      actionResolution,
      toolRequestResolution,
      executedBrainToolRequest,
      brainToolExecution,
      brainToolObservation,
      workflowRequestResolution,
      executedBrainWorkflowRequest,
      brainWorkflowExecution,
      brainWorkflowObservation,
      semanticIntentRuntime,
      actionClaimGuard,
      verificationGate,
      actionResultAssessment,
      humanApprovalRequest: humanApprovalRuntime?.approvalRequest ?? null,
      humanApprovalState: humanApprovalRuntime?.approvalState ?? null,
      approvalRequiredToolResult: humanApprovalRuntime?.approvalRequiredToolResult ?? null,
      humanApprovalPersistence,
      conversationRuntime,
      agentWorkCycle: workCycle,
      executionPlan,
      planExecutionCoordination,
      providerHealth,
      commandModulePath,
      request: requestForExecution,
      bootStatus: bootResult.status,
      readinessStatus: readiness.status,
      warnings: runtimeWarnings,
      warningRelevance,
      output: outputPayload,
      message: executionOutcome.message,
      startedAt,
      finishedAt,
    };

    const persistence = await writeInvocationArtifacts({
      masRootPath: bootResult.masRootPath,
      invocationId,
      invocationSession,
      request: requestForExecution,
      reportKind: executionOutcome.reportKind,
      reportContent,
    });

    return assertAgentExecutionResult({
      invocationId,
      primaryCognitiveIdentityId,
      operationalIdentityId: normalizedRequest.operationalIdentityId,
      status: executionStatus,
      request: requestForExecution,
      bootResult,
      readiness,
      message: executionOutcome.message,
      warnings: runtimeWarnings,
      warningRelevance,
      errors: executionStatus === 'failed'
        ? [brainOutput?.errorMessage ?? executionOutcome.message]
        : [],
      nextStep,
      startedAt,
      finishedAt,
      persistence,
      conversation: conversationRuntime,
      output: outputPayload,
      workCycle,
      executionPlan,
      planExecutionCoordination,
      verificationGate,
    });
  } catch (error) {
    const warningRelevance = buildWarningRelevanceForInvocation({
      warnings: [],
      request: normalizedRequest,
    });
    const nextStep = buildInvocationNextStep({
      status: 'failed',
      request: normalizedRequest,
    });
    const workCycle = buildAgentWorkCycleSummary({
      invocationId,
      primaryCognitiveIdentityId: null,
      operationalIdentityId: normalizedRequest.operationalIdentityId,
      request: normalizedRequest,
      executionStatus: 'failed',
      message: error.message,
      nextStep,
      persistenceCompleted: false,
    });

    return assertAgentExecutionResult({
      invocationId,
      primaryCognitiveIdentityId: null,
      operationalIdentityId: normalizedRequest.operationalIdentityId,
      status: 'failed',
      request: normalizedRequest,
      bootResult: null,
      readiness: null,
      message: error.message,
      warnings: [],
      warningRelevance,
      errors: [error.message],
      nextStep,
      startedAt,
      finishedAt: new Date().toISOString(),
      persistence: null,
      output: null,
      workCycle,
      executionPlan: null,
      planExecutionCoordination: null,
    });
  }
}
