import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { createStableMemoryRecordId, readMemorySourceFiles } from './read-memory-source-files.js';
import {
  buildOwnerSubjectReference,
  buildSourceGovernance,
  buildSourceReference,
  truncateText,
} from './memory-reader-utils.js';

function buildCognitiveIdentityMemorySummary(file) {
  const firstLine = file.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const snippet = truncateText(firstLine ?? file.content, 180);

  return `Cognitive identity memory ${file.relativePath} is available as portable expert context.${snippet ? ` Summary seed: ${snippet}` : ''}`;
}

export async function readCognitiveIdentityMemory({ masRootPath, sourceDefinition }) {
  const readResult = await readMemorySourceFiles({
    masRootPath,
    sourceDefinition,
    allowedExtensions: ['.md', '.json', '.txt'],
    preferNewest: false,
  });

  const memoryRecords = readResult.files.map((file) => {
    const content = file.content.trim();

    return assertMemoryRecord({
      kind: 'memory_record',
      version: 1,
      memoryRecordId: createStableMemoryRecordId('cognitive-identity-memory', file.relativePath, file.contentSha256),
      memoryType: 'professional_knowledge',
      ...buildSourceGovernance(readResult.sourceDefinition, {
        origin: 'steward_curated',
      }),
      approvalState: 'approved',
      lifecycleStatus: 'active',
      confidence: 'steward_approved',
      authorityLevel: 'team_guidance',
      summary: buildCognitiveIdentityMemorySummary(file),
      content: content.length > 0 ? content : null,
      sourceReferences: [
        buildSourceReference({
          sourceType: 'agent_local_memory',
          sourceId: file.fileName,
          sourceDefinition: readResult.sourceDefinition,
          file,
          createdAt: file.modifiedAt,
          origin: 'steward_curated',
        }),
      ],
      subjectReferences: [buildOwnerSubjectReference(readResult.sourceDefinition)],
      retention: {
        retentionPolicyId: 'default-cognitive-identity-memory',
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
