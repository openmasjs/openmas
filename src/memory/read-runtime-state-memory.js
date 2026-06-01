import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { createStableMemoryRecordId, readMemorySourceFiles } from './read-memory-source-files.js';
import {
  buildSourceGovernance,
  buildSourceReference,
  buildSubjectReferencesFromInvocationSession,
  pickCreatedAt,
  truncateText,
} from './memory-reader-utils.js';

function buildInvocationSessionSummary(session, file) {
  const invocationId = session.invocationId ?? file.fileName;
  const executionType = session.executionType ?? session.request?.invocationMode ?? 'unknown_execution';
  const status = session.status ?? session.readinessStatus ?? session.bootStatus ?? 'unknown_status';
  const primaryCognitiveIdentityId = session.primaryCognitiveIdentityId ?? 'unknown_cognitive_identity';
  const operationalIdentity = session.operationalIdentityId ?? 'unknown_operational_identity';
  const command = session.request?.command ?? 'unknown_command';
  const message = truncateText(session.message);

  return [
    `Invocation ${invocationId} recorded ${executionType} using Primary Cognitive Identity ${primaryCognitiveIdentityId}.`,
    `Operational identity: ${operationalIdentity}.`,
    `Command: ${command}.`,
    `Status: ${status}.`,
    message ? `Message: ${message}` : null,
  ].filter(Boolean).join(' ');
}

export async function readRuntimeStateMemory({ masRootPath, sourceDefinition }) {
  const readResult = await readMemorySourceFiles({
    masRootPath,
    sourceDefinition,
    allowedExtensions: ['.json'],
    preferNewest: true,
  });
  const memoryRecords = [];
  const warnings = [...readResult.warnings];

  for (const file of readResult.files) {
    let parsedSession;

    try {
      parsedSession = JSON.parse(file.content);
    } catch (error) {
      warnings.push(`Runtime state memory skipped invalid JSON file ${file.fileName}: ${error.message}`);
      continue;
    }

    const sourceId = parsedSession.invocationId ?? file.fileName;
    const createdAt = pickCreatedAt(parsedSession.startedAt, parsedSession.finishedAt, file.modifiedAt);

    memoryRecords.push(assertMemoryRecord({
      kind: 'memory_record',
      version: 1,
      memoryRecordId: createStableMemoryRecordId('runtime-state', file.relativePath, file.contentSha256),
      memoryType: 'runtime_evidence',
      ...buildSourceGovernance(readResult.sourceDefinition, {
        origin: 'system_generated',
      }),
      approvalState: 'not_required',
      lifecycleStatus: 'active',
      confidence: 'observed',
      authorityLevel: 'runtime_evidence',
      summary: buildInvocationSessionSummary(parsedSession, file),
      content: null,
      sourceReferences: [
        buildSourceReference({
          sourceType: 'invocation_session',
          sourceId,
          sourceDefinition: readResult.sourceDefinition,
          file,
          createdAt,
        }),
      ],
      subjectReferences: buildSubjectReferencesFromInvocationSession(parsedSession),
      retention: {
        retentionPolicyId: 'default-runtime-evidence',
        expiresAt: null,
        staleAfter: null,
        reviewRequiredAt: null,
      },
      supersession: {
        supersedesMemoryRecordIds: [],
        supersededByMemoryRecordId: null,
      },
      createdAt,
      updatedAt: file.modifiedAt,
      warnings: [],
    }));
  }

  return {
    sourceId: readResult.sourceDefinition.sourceId,
    memoryRecords,
    warnings,
  };
}
