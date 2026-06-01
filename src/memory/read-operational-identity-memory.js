import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { createStableMemoryRecordId, readMemorySourceFiles } from './read-memory-source-files.js';
import {
  buildOwnerSubjectReference,
  buildSourceGovernance,
  buildSourceReference,
  truncateText,
} from './memory-reader-utils.js';

function classifyOperationalMemoryType(fileName) {
  const normalizedFileName = fileName.toLowerCase();

  if (normalizedFileName.includes('preference')) {
    return 'human_preference';
  }

  if (normalizedFileName.includes('relationship')) {
    return 'relationship_note';
  }

  if (normalizedFileName.includes('task')) {
    return 'task_state';
  }

  return 'conversation_summary';
}

function buildOperationalIdentityMemorySummary({ file, memoryType }) {
  const firstLine = file.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const snippet = truncateText(firstLine ?? file.content, 180);

  return `Operational identity memory ${file.relativePath} classified as ${memoryType}.${snippet ? ` Summary seed: ${snippet}` : ''}`;
}

function resolveApprovalState(sourceDefinition) {
  return sourceDefinition.defaultVisibility === 'private_to_owner'
    ? 'not_required'
    : 'approved';
}

export async function readOperationalIdentityMemory({ masRootPath, sourceDefinition }) {
  const readResult = await readMemorySourceFiles({
    masRootPath,
    sourceDefinition,
    allowedExtensions: ['.md', '.json', '.txt'],
    preferNewest: true,
  });

  const memoryRecords = readResult.files.map((file) => {
    const memoryType = classifyOperationalMemoryType(file.fileName);
    const content = file.content.trim();

    return assertMemoryRecord({
      kind: 'memory_record',
      version: 1,
      memoryRecordId: createStableMemoryRecordId('operational-identity-memory', file.relativePath, file.contentSha256),
      memoryType,
      ...buildSourceGovernance(readResult.sourceDefinition, {
        origin: 'agent_proposed',
      }),
      approvalState: resolveApprovalState(readResult.sourceDefinition),
      lifecycleStatus: 'active',
      confidence: 'observed',
      authorityLevel: 'operational_note',
      summary: buildOperationalIdentityMemorySummary({ file, memoryType }),
      content: content.length > 0 ? content : null,
      sourceReferences: [
        buildSourceReference({
          sourceType: 'operational_identity_memory',
          sourceId: file.fileName,
          sourceDefinition: readResult.sourceDefinition,
          file,
          createdAt: file.modifiedAt,
          origin: 'agent_proposed',
        }),
      ],
      subjectReferences: [buildOwnerSubjectReference(readResult.sourceDefinition)],
      retention: {
        retentionPolicyId: 'default-operational-identity-memory',
        expiresAt: null,
        staleAfter: null,
        reviewRequiredAt: null,
      },
      supersession: {
        supersedesMemoryRecordIds: [],
        supersededByMemoryRecordId: null,
      },
      createdAt: file.modifiedAt,
      updatedAt: file.modifiedAt,
      warnings: [],
    });
  });

  return {
    sourceId: readResult.sourceDefinition.sourceId,
    memoryRecords,
    warnings: readResult.warnings,
  };
}
