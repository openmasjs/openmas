import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertGoldenExampleSetDefinition } from '../contracts/examples/golden-example-contract.js';

const GOLDEN_EXAMPLE_ROOT_PATH = path.join('evaluations', 'golden-examples');
const GOLDEN_EXAMPLE_FILE_NAME = 'examples.json';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeExampleSourcePath({ exampleDirectoryName }) {
  return `instance/evaluations/golden-examples/${exampleDirectoryName}/${GOLDEN_EXAMPLE_FILE_NAME}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => {
    return isNonEmptyString(value);
  }).map((value) => value.trim()))];
}

function resolveActiveCognitiveIdentityIds(readiness) {
  return uniqueStrings([
    readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
    ...(readiness?.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? []),
  ]);
}

function resolveOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId
    ?? readiness?.resolvedOperationalIdentity?.operationalIdentityId
    ?? null;
}

function hasIntersection(leftValues, rightValues) {
  const rightValueSet = new Set(rightValues);

  return leftValues.some((value) => rightValueSet.has(value));
}

function matchesInvocation({ definition, request, readiness }) {
  if (definition.lifecycleState !== 'active') {
    return false;
  }

  if (!definition.commandTriggers.includes(request?.command)) {
    return false;
  }

  const operationalIdentityId = resolveOperationalIdentityId(readiness);

  if (
    definition.operationalIdentityIds.length > 0
    && (!operationalIdentityId || !definition.operationalIdentityIds.includes(operationalIdentityId))
  ) {
    return false;
  }

  const activeCognitiveIdentityIds = resolveActiveCognitiveIdentityIds(readiness);

  if (
    definition.cognitiveIdentityIds.length > 0
    && !hasIntersection(definition.cognitiveIdentityIds, activeCognitiveIdentityIds)
  ) {
    return false;
  }

  return true;
}

async function readExampleDirectory({
  goldenExamplesRootPath,
  exampleDirectoryName,
  request,
  readiness,
}) {
  const exampleRootPath = resolveBoundedChildPath({
    parentRootPath: goldenExamplesRootPath,
    childRootPath: exampleDirectoryName,
    description: `Golden example set ${exampleDirectoryName} rootPath`,
  });
  const examplesPath = path.join(exampleRootPath, GOLDEN_EXAMPLE_FILE_NAME);
  const rawDefinition = await readFile(examplesPath, 'utf8');
  const definition = assertGoldenExampleSetDefinition(JSON.parse(rawDefinition));

  if (!matchesInvocation({ definition, request, readiness })) {
    return null;
  }

  return {
    ...definition,
    sourcePath: normalizeExampleSourcePath({
      exampleDirectoryName,
    }),
  };
}

export async function readGoldenExamplesForInvocation({
  masRootPath,
  request,
  readiness,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Golden example reader requires a non-empty masRootPath.');
  }

  const goldenExamplesRootPath = path.join(masRootPath, GOLDEN_EXAMPLE_ROOT_PATH);
  const exampleSets = [];
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(goldenExamplesRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exampleSets,
        warnings: [`Golden example rootPath does not exist: ${GOLDEN_EXAMPLE_ROOT_PATH.replaceAll(path.sep, '/')}`],
      };
    }

    throw error;
  }

  for (const directoryEntry of directoryEntries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!directoryEntry.isDirectory()) {
      warnings.push(`Golden example reader skipped non-directory entry: ${directoryEntry.name}`);
      continue;
    }

    try {
      const exampleSet = await readExampleDirectory({
        goldenExamplesRootPath,
        exampleDirectoryName: directoryEntry.name,
        request,
        readiness,
      });

      if (exampleSet) {
        exampleSets.push(exampleSet);
      }
    } catch (error) {
      warnings.push(`Golden example reader skipped ${directoryEntry.name}: ${error.message}`);
    }
  }

  return {
    exampleSets: exampleSets.toSorted((left, right) => {
      return left.exampleSetId.localeCompare(right.exampleSetId);
    }),
    warnings,
  };
}

export {
  GOLDEN_EXAMPLE_FILE_NAME,
  GOLDEN_EXAMPLE_ROOT_PATH,
};
