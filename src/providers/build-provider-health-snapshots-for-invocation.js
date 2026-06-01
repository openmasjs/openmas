import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertProviderHealthSnapshotCollection } from '../contracts/providers/provider-health-snapshot-contract.js';

const DEFAULT_MAX_HISTORICAL_SESSIONS = 12;
const INVOCATION_SESSION_FILE_PREFIX = 'agent-invocation-';
const INVOCATION_SESSION_FILE_EXTENSION = '.json';
const PROVIDER_HEALTH_STATE_ROOT = 'memory/state';

const UNAVAILABLE_FAILURE_CATEGORIES = new Set([
  'transient_unavailable',
  'timeout',
  'network_error',
  'provider_internal_error',
]);

const ROLE_PRIORITY = new Map([
  ['selected_brain', 0],
  ['semantic_classifier', 1],
  ['fallback_brain', 2],
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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

function toIsoTimestamp(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }

  const parsedValue = Date.parse(value.trim());

  if (Number.isNaN(parsedValue)) {
    return null;
  }

  return new Date(parsedValue).toISOString();
}

function compareEventsDescending(left, right) {
  const leftTimestamp = left.occurredAt ? Date.parse(left.occurredAt) : 0;
  const rightTimestamp = right.occurredAt ? Date.parse(right.occurredAt) : 0;

  if (rightTimestamp !== leftTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return (right.sequenceNumber ?? 0) - (left.sequenceNumber ?? 0);
}

function nextSequence(sequenceNumber) {
  return sequenceNumber + 1;
}

function createProviderEvent({
  providerId,
  modelId,
  requestType,
  status,
  failureCategory = null,
  invocationId = null,
  occurredAt = null,
  source = 'brain_execution',
  roleId = null,
  sequenceNumber = 0,
}) {
  if (!isNonEmptyString(providerId)) {
    return null;
  }

  if (!['completed', 'failed'].includes(status)) {
    return null;
  }

  return {
    providerId: providerId.trim(),
    modelId: isNonEmptyString(modelId) ? modelId.trim() : null,
    requestType: isNonEmptyString(requestType) ? requestType.trim() : null,
    status,
    failureCategory: isNonEmptyString(failureCategory) ? failureCategory.trim() : null,
    invocationId: isNonEmptyString(invocationId) ? invocationId.trim() : null,
    occurredAt: toIsoTimestamp(occurredAt),
    source,
    roleId,
    sequenceNumber,
  };
}

function extractBrainExecutionProviderEvents({ invocationSession, occurredAt }) {
  const attempts = Array.isArray(invocationSession.brainExecution?.attempts)
    ? invocationSession.brainExecution.attempts
    : [];
  const initialAttempts = attempts.filter((attempt) => {
    return attempt.passKind === 'initial_reasoning';
  });
  const followupAttempts = attempts.filter((attempt) => {
    return attempt.passKind !== 'initial_reasoning';
  });
  let sequenceNumber = 0;
  const events = [];

  for (const attempt of initialAttempts) {
    sequenceNumber = nextSequence(sequenceNumber);
    const event = createProviderEvent({
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      requestType: attempt.providerResponse?.requestType ?? attempt.brainOutput?.requestType ?? 'generate_text',
      status: attempt.status,
      failureCategory: attempt.providerResponse?.providerFailure?.category
        ?? attempt.brainOutput?.providerFailure?.category
        ?? null,
      invocationId: invocationSession.invocationId,
      occurredAt,
      source: 'brain_execution',
      roleId: attempt.brainRole === 'fallback' ? 'fallback_brain' : 'selected_brain',
      sequenceNumber,
    });

    if (event) {
      events.push(event);
    }
  }

  return {
    events,
    sequenceNumber,
    followupAttempts,
  };
}

function extractSemanticClassifierProviderEvents({
  invocationSession,
  occurredAt,
  startingSequenceNumber,
}) {
  const providerClassifierAudit = invocationSession.semanticIntentRuntime?.providerClassifierAudit ?? null;

  if (!providerClassifierAudit) {
    return {
      events: [],
      sequenceNumber: startingSequenceNumber,
    };
  }

  const providerId = providerClassifierAudit.providerRequest?.providerId
    ?? providerClassifierAudit.providerResponse?.providerId
    ?? null;
  const modelId = providerClassifierAudit.providerRequest?.modelId
    ?? providerClassifierAudit.providerResponse?.modelId
    ?? null;
  const requestType = providerClassifierAudit.requestType
    ?? providerClassifierAudit.providerRequest?.requestType
    ?? 'classify_intent';
  const attempts = Array.isArray(providerClassifierAudit.attempts)
    ? providerClassifierAudit.attempts
    : [];
  let sequenceNumber = startingSequenceNumber;
  const events = [];

  for (const attempt of attempts) {
    sequenceNumber = nextSequence(sequenceNumber);
    const event = createProviderEvent({
      providerId,
      modelId,
      requestType,
      status: attempt.status,
      failureCategory: attempt.failureCategory ?? null,
      invocationId: invocationSession.invocationId,
      occurredAt,
      source: 'semantic_classifier',
      roleId: 'semantic_classifier',
      sequenceNumber,
    });

    if (event) {
      events.push(event);
    }
  }

  return {
    events,
    sequenceNumber,
  };
}

function extractFollowupBrainProviderEvents({
  invocationSession,
  occurredAt,
  followupAttempts,
  startingSequenceNumber,
}) {
  let sequenceNumber = startingSequenceNumber;
  const events = [];

  for (const attempt of followupAttempts) {
    sequenceNumber = nextSequence(sequenceNumber);
    const event = createProviderEvent({
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      requestType: attempt.providerResponse?.requestType ?? attempt.brainOutput?.requestType ?? 'generate_text',
      status: attempt.status,
      failureCategory: attempt.providerResponse?.providerFailure?.category
        ?? attempt.brainOutput?.providerFailure?.category
        ?? null,
      invocationId: invocationSession.invocationId,
      occurredAt,
      source: 'brain_execution_followup',
      roleId: attempt.brainRole === 'fallback' ? 'fallback_brain' : 'selected_brain',
      sequenceNumber,
    });

    if (event) {
      events.push(event);
    }
  }

  return {
    events,
    sequenceNumber,
  };
}

export function extractProviderHealthEventsFromInvocationSession(invocationSession, {
  fallbackOccurredAt = null,
} = {}) {
  if (!isPlainObject(invocationSession)) {
    return [];
  }

  const occurredAt = toIsoTimestamp(
    invocationSession.finishedAt
    ?? invocationSession.startedAt
    ?? fallbackOccurredAt,
  );
  const {
    events: initialBrainEvents,
    sequenceNumber: brainSequenceNumber,
    followupAttempts,
  } = extractBrainExecutionProviderEvents({
    invocationSession,
    occurredAt,
  });
  const {
    events: classifierEvents,
    sequenceNumber: classifierSequenceNumber,
  } = extractSemanticClassifierProviderEvents({
    invocationSession,
    occurredAt,
    startingSequenceNumber: brainSequenceNumber,
  });
  const { events: followupBrainEvents } = extractFollowupBrainProviderEvents({
    invocationSession,
    occurredAt,
    followupAttempts,
    startingSequenceNumber: classifierSequenceNumber,
  });

  return [
    ...initialBrainEvents,
    ...classifierEvents,
    ...followupBrainEvents,
  ];
}

function createCurrentProviderAssignments({ providerPreparation, semanticIntentRuntime }) {
  const assignments = [];

  if (providerPreparation?.selectedBrainProvider?.providerId) {
    assignments.push({
      providerId: providerPreparation.selectedBrainProvider.providerId,
      modelId: providerPreparation.selectedBrainProvider.modelId ?? null,
      roleId: 'selected_brain',
      readinessStatus: providerPreparation.selectedBrainProvider.status === 'ready' ? 'ready' : 'not_ready',
    });
  }

  if (providerPreparation?.fallbackBrainProvider?.providerId) {
    assignments.push({
      providerId: providerPreparation.fallbackBrainProvider.providerId,
      modelId: providerPreparation.fallbackBrainProvider.modelId ?? null,
      roleId: 'fallback_brain',
      readinessStatus: providerPreparation.fallbackBrainProvider.status === 'ready' ? 'ready' : 'not_ready',
    });
  }

  const providerClassifierAudit = semanticIntentRuntime?.providerClassifierAudit ?? null;
  const classifierProviderId = providerClassifierAudit?.providerRequest?.providerId
    ?? providerClassifierAudit?.providerResponse?.providerId
    ?? null;
  const classifierModelId = providerClassifierAudit?.providerRequest?.modelId
    ?? providerClassifierAudit?.providerResponse?.modelId
    ?? null;

  if (classifierProviderId) {
    assignments.push({
      providerId: classifierProviderId,
      modelId: classifierModelId,
      roleId: 'semantic_classifier',
      readinessStatus: 'ready',
    });
  }

  return assignments;
}

async function readHistoricalInvocationSessions({
  masRootPath,
  maxHistoricalSessions = DEFAULT_MAX_HISTORICAL_SESSIONS,
}) {
  const stateRootPath = resolveBoundedChildPath({
    parentRootPath: masRootPath,
    childRootPath: PROVIDER_HEALTH_STATE_ROOT,
    description: 'Provider health state root',
  });
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(stateRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        sessions: [],
        warnings: [],
      };
    }

    throw error;
  }

  const candidateFiles = [];

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile()) {
      continue;
    }

    if (!directoryEntry.name.startsWith(INVOCATION_SESSION_FILE_PREFIX)) {
      continue;
    }

    if (!directoryEntry.name.endsWith(INVOCATION_SESSION_FILE_EXTENSION)) {
      continue;
    }

    const absoluteFilePath = path.join(stateRootPath, directoryEntry.name);
    const fileStat = await stat(absoluteFilePath);

    candidateFiles.push({
      absoluteFilePath,
      fileName: directoryEntry.name,
      modifiedAt: fileStat.mtime.toISOString(),
      modifiedAtMs: fileStat.mtimeMs,
    });
  }

  candidateFiles.sort((left, right) => {
    if (right.modifiedAtMs !== left.modifiedAtMs) {
      return right.modifiedAtMs - left.modifiedAtMs;
    }

    return left.fileName.localeCompare(right.fileName);
  });

  const selectedFiles = candidateFiles.slice(0, maxHistoricalSessions);
  const sessions = [];

  for (const selectedFile of selectedFiles) {
    try {
      const rawContent = await readFile(selectedFile.absoluteFilePath, 'utf8');
      const invocationSession = JSON.parse(rawContent);

      if (!isPlainObject(invocationSession)) {
        warnings.push(`Provider health skipped non-object invocation session file ${selectedFile.fileName}.`);
        continue;
      }

      sessions.push({
        invocationSession,
        modifiedAt: selectedFile.modifiedAt,
      });
    } catch (error) {
      warnings.push(`Provider health skipped unreadable invocation session file ${selectedFile.fileName}: ${error.message}`);
    }
  }

  return {
    sessions,
    warnings,
  };
}

function buildRoleImpactSummary({
  roleId,
  impactLevel,
  readinessStatus,
  healthStatus,
}) {
  const roleLabels = {
    selected_brain: 'Selected brain provider',
    fallback_brain: 'Fallback brain provider',
    semantic_classifier: 'Semantic classifier provider',
  };

  const roleLabel = roleLabels[roleId] ?? roleId;

  if (readinessStatus === 'not_ready') {
    return `${roleLabel} is not ready for the current invocation.`;
  }

  if (healthStatus === 'unavailable') {
    if (roleId === 'fallback_brain') {
      return `${roleLabel} is currently unavailable; runtime fallback resilience is reduced.`;
    }

    if (roleId === 'semantic_classifier') {
      return `${roleLabel} is currently unavailable; semantic routing may degrade or require clarification.`;
    }

    return `${roleLabel} is currently unavailable and has ${impactLevel} impact on the current invocation.`;
  }

  if (healthStatus === 'degraded') {
    if (roleId === 'fallback_brain') {
      return `${roleLabel} is degraded; fallback resilience should be reviewed.`;
    }

    if (roleId === 'semantic_classifier') {
      return `${roleLabel} is degraded; semantic routing should be monitored.`;
    }

    return `${roleLabel} is degraded and should be monitored for the current invocation.`;
  }

  if (healthStatus === 'healthy') {
    return `${roleLabel} is healthy for the current invocation.`;
  }

  return `${roleLabel} has no recent runtime evidence yet, but it is assigned to the current invocation.`;
}

function createProviderRoleImpacts({
  providerId,
  providerAssignments,
  healthStatus,
}) {
  return providerAssignments
    .filter((assignment) => {
      return assignment.providerId === providerId;
    })
    .sort((left, right) => {
      return (ROLE_PRIORITY.get(left.roleId) ?? Number.MAX_SAFE_INTEGER)
        - (ROLE_PRIORITY.get(right.roleId) ?? Number.MAX_SAFE_INTEGER);
    })
    .map((assignment) => {
      const impactLevel = assignment.roleId === 'fallback_brain' ? 'supporting' : 'critical';

      return {
        roleId: assignment.roleId,
        impactLevel,
        readinessStatus: assignment.readinessStatus,
        summary: buildRoleImpactSummary({
          roleId: assignment.roleId,
          impactLevel,
          readinessStatus: assignment.readinessStatus,
          healthStatus,
        }),
      };
    });
}

function buildProviderRoleImpactSummary({
  providerRoleImpacts,
  healthStatus,
}) {
  if (providerRoleImpacts.length === 0) {
    if (healthStatus === 'unknown') {
      return 'No current provider role is assigned and no recent runtime evidence is available.';
    }

    return 'No current provider role is assigned for this invocation.';
  }

  return providerRoleImpacts.map((entry) => entry.summary).join(' ');
}

function buildProviderHealthSnapshot({
  providerId,
  providerEvents,
  providerAssignments,
}) {
  const sortedEvents = [...providerEvents].sort(compareEventsDescending);
  const latestEvent = sortedEvents[0] ?? null;
  const lastSuccessEvent = sortedEvents.find((event) => {
    return event.status === 'completed';
  }) ?? null;
  const lastFailureEvent = sortedEvents.find((event) => {
    return event.status === 'failed';
  }) ?? null;
  let consecutiveFailureCount = 0;

  for (const event of sortedEvents) {
    if (event.status !== 'failed') {
      break;
    }

    consecutiveFailureCount += 1;
  }

  const degraded = latestEvent?.status === 'failed';
  const unavailable = degraded
    && consecutiveFailureCount >= 2
    && UNAVAILABLE_FAILURE_CATEGORIES.has(lastFailureEvent?.failureCategory ?? '');
  const healthStatus = unavailable
    ? 'unavailable'
    : degraded
      ? 'degraded'
      : latestEvent?.status === 'completed'
        ? 'healthy'
        : 'unknown';
  const providerRoleImpacts = createProviderRoleImpacts({
    providerId,
    providerAssignments,
    healthStatus,
  });

  return {
    kind: 'provider_health_snapshot',
    version: 1,
    providerId,
    modelIds: uniqueStrings([
      ...providerEvents.map((event) => event.modelId),
      ...providerAssignments
        .filter((assignment) => assignment.providerId === providerId)
        .map((assignment) => assignment.modelId),
    ]),
    observedRequestTypes: uniqueStrings(providerEvents.map((event) => event.requestType)),
    latestEventAt: latestEvent?.occurredAt ?? null,
    latestEventStatus: latestEvent?.status ?? null,
    lastSuccessAt: lastSuccessEvent?.occurredAt ?? null,
    lastFailureAt: lastFailureEvent?.occurredAt ?? null,
    lastFailureCategory: lastFailureEvent?.failureCategory ?? null,
    consecutiveFailureCount,
    observedAttemptCount: providerEvents.length,
    successfulAttemptCount: providerEvents.filter((event) => {
      return event.status === 'completed';
    }).length,
    failedAttemptCount: providerEvents.filter((event) => {
      return event.status === 'failed';
    }).length,
    degraded,
    unavailable,
    healthStatus,
    providerRoleImpactSummary: buildProviderRoleImpactSummary({
      providerRoleImpacts,
      healthStatus,
    }),
    providerRoleImpacts,
    warnings: [],
  };
}

export function buildProviderHealthSnapshotCollection({
  providerAssignments = [],
  providerEvents = [],
  generatedAt = new Date().toISOString(),
  maxHistoricalSessions = DEFAULT_MAX_HISTORICAL_SESSIONS,
  includedHistoricalSessionCount = 0,
  includedCurrentInvocation = false,
  warnings = [],
} = {}) {
  const relevantProviderIds = uniqueStrings([
    ...providerAssignments.map((assignment) => assignment.providerId),
    ...providerEvents.map((event) => event.providerId),
  ]);
  const snapshots = relevantProviderIds.map((providerId) => {
    return buildProviderHealthSnapshot({
      providerId,
      providerEvents: providerEvents.filter((event) => {
        return event.providerId === providerId;
      }),
      providerAssignments,
    });
  });

  return assertProviderHealthSnapshotCollection({
    kind: 'provider_health_snapshot_collection',
    version: 1,
    generatedAt,
    maxHistoricalSessions,
    includedHistoricalSessionCount,
    includedCurrentInvocation,
    snapshots,
    warnings: uniqueStrings(warnings),
  });
}

export async function buildProviderHealthSnapshotsForInvocation({
  masRootPath,
  invocationId = null,
  startedAt = null,
  finishedAt = null,
  providerPreparation = null,
  brainExecution = null,
  semanticIntentRuntime = null,
  maxHistoricalSessions = DEFAULT_MAX_HISTORICAL_SESSIONS,
}) {
  const { sessions, warnings: historyWarnings } = await readHistoricalInvocationSessions({
    masRootPath,
    maxHistoricalSessions,
  });
  const historicalEvents = sessions.flatMap(({ invocationSession, modifiedAt }) => {
    return extractProviderHealthEventsFromInvocationSession(invocationSession, {
      fallbackOccurredAt: modifiedAt,
    });
  });
  const currentInvocationSession = {
    invocationId,
    startedAt,
    finishedAt,
    brainExecution,
    semanticIntentRuntime,
  };
  const currentInvocationEvents = extractProviderHealthEventsFromInvocationSession(currentInvocationSession, {
    fallbackOccurredAt: finishedAt ?? startedAt ?? new Date().toISOString(),
  });
  const providerAssignments = createCurrentProviderAssignments({
    providerPreparation,
    semanticIntentRuntime,
  });

  return buildProviderHealthSnapshotCollection({
    providerAssignments,
    providerEvents: [
      ...historicalEvents,
      ...currentInvocationEvents,
    ],
    generatedAt: finishedAt ?? new Date().toISOString(),
    maxHistoricalSessions,
    includedHistoricalSessionCount: sessions.length,
    includedCurrentInvocation: currentInvocationEvents.length > 0,
    warnings: historyWarnings,
  });
}

export function buildProviderHealthReportSection(providerHealth) {
  if (!providerHealth || !Array.isArray(providerHealth.snapshots) || providerHealth.snapshots.length === 0) {
    return '';
  }

  return [
    '## Provider Health Snapshot',
    '',
    `Historical Sessions Reviewed: ${providerHealth.includedHistoricalSessionCount}`,
    `Current Invocation Included: ${providerHealth.includedCurrentInvocation ? 'yes' : 'no'}`,
    '',
    ...providerHealth.snapshots.flatMap((snapshot) => {
      return [
        `### ${snapshot.providerId}`,
        `- Health Status: ${snapshot.healthStatus}`,
        `- Latest Event: ${snapshot.latestEventStatus ?? 'n/a'} at ${snapshot.latestEventAt ?? 'n/a'}`,
        `- Last Success: ${snapshot.lastSuccessAt ?? 'n/a'}`,
        `- Last Failure: ${snapshot.lastFailureAt ?? 'n/a'}`,
        `- Last Failure Category: ${snapshot.lastFailureCategory ?? 'n/a'}`,
        `- Consecutive Failures: ${snapshot.consecutiveFailureCount}`,
        `- Unavailable: ${snapshot.unavailable ? 'yes' : 'no'}`,
        `- Role Impact: ${snapshot.providerRoleImpactSummary}`,
        '',
      ];
    }),
  ].join('\n');
}

export {
  DEFAULT_MAX_HISTORICAL_SESSIONS,
};
