import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { createStableMemoryRecordId, readMemorySourceFiles } from './read-memory-source-files.js';
import {
  buildOwnerSubjectReference,
  buildSourceGovernance,
  buildSourceReference,
  truncateText,
} from './memory-reader-utils.js';

function buildPolicySummary(file) {
  const firstLine = file.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const snippet = truncateText(firstLine ?? file.content, 180);

  return `Policy document ${file.relativePath} is available as governed policy context.${snippet ? ` Summary seed: ${snippet}` : ''}`;
}

export async function readPolicyMemory({ masRootPath, sourceDefinition }) {
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
      memoryRecordId: createStableMemoryRecordId('policy', file.relativePath, file.contentSha256),
      memoryType: 'policy_context',
      ...buildSourceGovernance(readResult.sourceDefinition, {
        origin: 'imported_document',
      }),
      approvalState: 'approved',
      lifecycleStatus: 'active',
      confidence: 'human_approved',
      authorityLevel: 'policy',
      summary: buildPolicySummary(file),
      content: content.length > 0 ? content : null,
      sourceReferences: [
        buildSourceReference({
          sourceType: 'policy_document',
          sourceId: file.fileName,
          sourceDefinition: readResult.sourceDefinition,
          file,
          createdAt: file.modifiedAt,
          origin: 'imported_document',
        }),
      ],
      subjectReferences: [buildOwnerSubjectReference(readResult.sourceDefinition)],
      retention: {
        retentionPolicyId: 'default-policy-memory',
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
