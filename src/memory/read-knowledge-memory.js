import { assertMemoryRecord } from '../contracts/memory/memory-record-contract.js';
import { createStableMemoryRecordId, readMemorySourceFiles } from './read-memory-source-files.js';
import {
  buildOwnerSubjectReference,
  buildSourceGovernance,
  buildSourceReference,
  truncateText,
} from './memory-reader-utils.js';

function classifyKnowledgeMemoryType({ sourceDefinition, fileName }) {
  const normalizedFileName = fileName.toLowerCase();

  if (sourceDefinition.scope === 'cognitive_identity') {
    return 'professional_knowledge';
  }

  if (normalizedFileName.includes('brand')) {
    return 'brand_rule';
  }

  if (
    normalizedFileName.includes('company')
    || normalizedFileName.includes('mission')
    || normalizedFileName.includes('vision')
  ) {
    return 'company_fact';
  }

  return 'domain_fact';
}

function buildKnowledgeSummary({ file, memoryType }) {
  const firstLine = file.content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const snippet = truncateText(firstLine ?? file.content, 180);

  return `Knowledge document ${file.relativePath} classified as ${memoryType}.${snippet ? ` Summary seed: ${snippet}` : ''}`;
}

export async function readKnowledgeMemory({ masRootPath, sourceDefinition }) {
  const readResult = await readMemorySourceFiles({
    masRootPath,
    sourceDefinition,
    allowedExtensions: ['.md', '.json', '.txt'],
    preferNewest: false,
  });

  const memoryRecords = readResult.files.map((file) => {
    const memoryType = classifyKnowledgeMemoryType({
      sourceDefinition: readResult.sourceDefinition,
      fileName: file.fileName,
    });
    const content = file.content.trim();

    return assertMemoryRecord({
      kind: 'memory_record',
      version: 1,
      memoryRecordId: createStableMemoryRecordId('knowledge', file.relativePath, file.contentSha256),
      memoryType,
      ...buildSourceGovernance(readResult.sourceDefinition, {
        origin: 'imported_document',
      }),
      approvalState: 'approved',
      lifecycleStatus: 'active',
      confidence: 'human_approved',
      authorityLevel: 'mas_guidance',
      summary: buildKnowledgeSummary({ file, memoryType }),
      content: content.length > 0 ? content : null,
      sourceReferences: [
        buildSourceReference({
          sourceType: 'knowledge_document',
          sourceId: file.fileName,
          sourceDefinition: readResult.sourceDefinition,
          file,
          createdAt: file.modifiedAt,
          origin: 'imported_document',
        }),
      ],
      subjectReferences: [buildOwnerSubjectReference(readResult.sourceDefinition)],
      retention: {
        retentionPolicyId: 'default-knowledge-memory',
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
