import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { createStableMemoryRecordId, readMemorySourceFiles } from './read-memory-source-files.js';
import {
  buildOwnerSubjectReference,
  buildSourceGovernance,
  buildSourceReference,
} from './memory-reader-utils.js';

function buildArtifactSummary(file) {
  return `Runtime artifact reference ${file.relativePath} (${file.sizeBytes} bytes, modified ${file.modifiedAt}).`;
}

export async function readRuntimeArtifactMemory({ masRootPath, sourceDefinition }) {
  const readResult = await readMemorySourceFiles({
    masRootPath,
    sourceDefinition,
    allowedExtensions: ['.md', '.json'],
    preferNewest: true,
  });

  const memoryRecords = readResult.files.map((file) => {
    return assertMemoryRecord({
      kind: 'memory_record',
      version: 1,
      memoryRecordId: createStableMemoryRecordId('runtime-artifact', file.relativePath, file.contentSha256),
      memoryType: 'artifact_reference',
      ...buildSourceGovernance(readResult.sourceDefinition, {
        origin: 'system_generated',
      }),
      approvalState: 'not_required',
      lifecycleStatus: 'active',
      confidence: 'observed',
      authorityLevel: 'runtime_evidence',
      summary: buildArtifactSummary(file),
      content: null,
      sourceReferences: [
        buildSourceReference({
          sourceType: 'artifact',
          sourceId: file.fileName,
          sourceDefinition: readResult.sourceDefinition,
          file,
          createdAt: file.modifiedAt,
        }),
      ],
      subjectReferences: [buildOwnerSubjectReference(readResult.sourceDefinition)],
      retention: {
        retentionPolicyId: 'default-runtime-artifact',
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
      warnings: ['Artifact body was intentionally not included as memory content.'],
    });
  });

  return {
    sourceId: readResult.sourceDefinition.sourceId,
    memoryRecords,
    warnings: readResult.warnings,
  };
}
