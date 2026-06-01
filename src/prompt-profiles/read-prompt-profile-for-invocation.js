import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { resolveBoundedChildPath } from '../contracts/shared/bounded-path-contract.js';
import { assertPromptProfileDefinition } from '../contracts/prompts/prompt-profile-contract.js';
import { createDefaultPromptBudgetPolicy } from '../brain/apply-prompt-budget-to-instruction-layers.js';

const PROMPT_PROFILE_ROOT_PATH = path.join('prompt-factory', 'profiles');
const PROMPT_PROFILE_FILE_NAME = 'profile.json';
const DEFAULT_PROMPT_PROFILE_ID = 'default-layered-prompt-profile-v1';
const DEFAULT_PROMPT_STACK_VERSION_ID = 'prompt-stack-v1';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeProfileSourcePath({ profileDirectoryName }) {
  return `instance/prompt-factory/profiles/${profileDirectoryName}/${PROMPT_PROFILE_FILE_NAME}`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => {
    return isNonEmptyString(value);
  }).map((value) => value.trim()))];
}

function resolveOperationalIdentityId(readiness) {
  return readiness?.operationalIdentityDefinition?.operationalIdentityId
    ?? readiness?.resolvedOperationalIdentity?.operationalIdentityId
    ?? null;
}

function resolveActiveCognitiveIdentityIds(readiness) {
  return uniqueStrings([
    readiness?.activeCognitiveSet?.primaryCognitiveIdentityId,
    ...(readiness?.activeCognitiveSet?.secondaryCognitiveIdentityIds ?? []),
  ]);
}

function resolveExecutionMode(readiness) {
  return readiness?.executionProfileDefinition?.executionMode ?? null;
}

function valuesMatch(criteriaValues, actualValue) {
  return criteriaValues.length === 0 || (
    isNonEmptyString(actualValue)
    && criteriaValues.includes(actualValue.trim())
  );
}

function valuesIntersect(criteriaValues, actualValues) {
  if (criteriaValues.length === 0) {
    return true;
  }

  const actualValueSet = new Set(actualValues);

  return criteriaValues.some((value) => {
    return actualValueSet.has(value);
  });
}

function computeSpecificityScore(selectionCriteria) {
  return [
    [selectionCriteria.operationalIdentityIds, 100],
    [selectionCriteria.commands, 80],
    [selectionCriteria.invocationModes, 70],
    [selectionCriteria.executionModes, 60],
    [selectionCriteria.cognitiveIdentityIds, 50],
    [selectionCriteria.providerIds, 30],
    [selectionCriteria.modelIds, 20],
  ].reduce((score, [values, weight]) => {
    return score + (values.length > 0 ? weight : 0);
  }, 0);
}

function matchesInvocation({
  profile,
  request,
  readiness,
  brainReference,
}) {
  if (profile.lifecycleState !== 'active') {
    return false;
  }

  const criteria = profile.selectionCriteria;

  return (
    valuesMatch(criteria.operationalIdentityIds, resolveOperationalIdentityId(readiness))
    && valuesMatch(criteria.commands, request?.command)
    && valuesMatch(criteria.invocationModes, request?.invocationMode)
    && valuesMatch(criteria.executionModes, resolveExecutionMode(readiness))
    && valuesIntersect(criteria.cognitiveIdentityIds, resolveActiveCognitiveIdentityIds(readiness))
    && valuesMatch(criteria.providerIds, brainReference?.providerId)
    && valuesMatch(criteria.modelIds, brainReference?.modelId)
  );
}

function buildDefaultPromptProfile() {
  return assertPromptProfileDefinition({
    kind: 'prompt_profile_definition',
    version: 1,
    promptProfileId: DEFAULT_PROMPT_PROFILE_ID,
    promptStackVersionId: DEFAULT_PROMPT_STACK_VERSION_ID,
    displayName: 'Default Layered Prompt Profile',
    description: 'Framework-owned default Prompt Factory profile used when no MAS-owned profile matches.',
    lifecycleState: 'active',
    selectionPriority: 0,
    selectionCriteria: {},
    promptBudgetPolicy: createDefaultPromptBudgetPolicy(),
    warnings: [],
  });
}

function buildSelectionReport({
  selectedProfile,
  selectionSource,
  sourcePath,
  candidateCount,
  matchedCandidateCount,
  specificityScore,
  warnings,
}) {
  return {
    kind: 'prompt_profile_selection',
    version: 1,
    selectedProfileId: selectedProfile.promptProfileId,
    promptStackVersionId: selectedProfile.promptStackVersionId,
    selectionSource,
    sourcePath,
    candidateCount,
    matchedCandidateCount,
    selectionPriority: selectedProfile.selectionPriority,
    specificityScore,
    warnings,
  };
}

async function readProfileDirectory({
  profilesRootPath,
  profileDirectoryName,
}) {
  const profileRootPath = resolveBoundedChildPath({
    parentRootPath: profilesRootPath,
    childRootPath: profileDirectoryName,
    description: `Prompt profile ${profileDirectoryName} rootPath`,
  });
  const profilePath = path.join(profileRootPath, PROMPT_PROFILE_FILE_NAME);
  const rawProfile = await readFile(profilePath, 'utf8');
  const profile = assertPromptProfileDefinition(JSON.parse(rawProfile));

  return {
    ...profile,
    sourcePath: normalizeProfileSourcePath({
      profileDirectoryName,
    }),
  };
}

function selectPromptProfile({
  profiles,
  request,
  readiness,
  brainReference,
  warnings,
}) {
  const matchedProfiles = profiles
    .filter((profile) => {
      return matchesInvocation({
        profile,
        request,
        readiness,
        brainReference,
      });
    })
    .map((profile) => {
      return {
        profile,
        specificityScore: computeSpecificityScore(profile.selectionCriteria),
      };
    });

  if (matchedProfiles.length === 0) {
    const defaultProfile = buildDefaultPromptProfile();

    return {
      promptProfile: defaultProfile,
      selectionReport: buildSelectionReport({
        selectedProfile: defaultProfile,
        selectionSource: profiles.length === 0 ? 'framework_default' : 'framework_default_no_match',
        sourcePath: null,
        candidateCount: profiles.length,
        matchedCandidateCount: 0,
        specificityScore: 0,
        warnings,
      }),
      warnings,
    };
  }

  const sortedMatches = matchedProfiles.toSorted((left, right) => {
    if (left.profile.selectionPriority !== right.profile.selectionPriority) {
      return right.profile.selectionPriority - left.profile.selectionPriority;
    }

    if (left.specificityScore !== right.specificityScore) {
      return right.specificityScore - left.specificityScore;
    }

    return left.profile.promptProfileId.localeCompare(right.profile.promptProfileId);
  });
  const selectedMatch = sortedMatches[0];
  const secondMatch = sortedMatches[1] ?? null;
  const resolvedWarnings = [...warnings];

  if (
    secondMatch
    && secondMatch.profile.selectionPriority === selectedMatch.profile.selectionPriority
    && secondMatch.specificityScore === selectedMatch.specificityScore
  ) {
    resolvedWarnings.push(
      `Prompt profile resolver found a deterministic tie between ${selectedMatch.profile.promptProfileId} and ${secondMatch.profile.promptProfileId}; selected lexicographically first profile.`,
    );
  }

  return {
    promptProfile: selectedMatch.profile,
    selectionReport: buildSelectionReport({
      selectedProfile: selectedMatch.profile,
      selectionSource: 'mas_profile',
      sourcePath: selectedMatch.profile.sourcePath,
      candidateCount: profiles.length,
      matchedCandidateCount: matchedProfiles.length,
      specificityScore: selectedMatch.specificityScore,
      warnings: resolvedWarnings,
    }),
    warnings: resolvedWarnings,
  };
}

export async function readPromptProfileForInvocation({
  masRootPath,
  request,
  readiness,
  brainReference,
} = {}) {
  if (!isNonEmptyString(masRootPath)) {
    throw new Error('Prompt profile reader requires a non-empty masRootPath.');
  }

  const profilesRootPath = path.join(masRootPath, PROMPT_PROFILE_ROOT_PATH);
  const profiles = [];
  const warnings = [];
  let directoryEntries;

  try {
    directoryEntries = await readdir(profilesRootPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return selectPromptProfile({
        profiles,
        request,
        readiness,
        brainReference,
        warnings,
      });
    }

    throw error;
  }

  for (const directoryEntry of directoryEntries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!directoryEntry.isDirectory()) {
      warnings.push(`Prompt profile reader skipped non-directory entry: ${directoryEntry.name}`);
      continue;
    }

    try {
      profiles.push(await readProfileDirectory({
        profilesRootPath,
        profileDirectoryName: directoryEntry.name,
      }));
    } catch (error) {
      warnings.push(`Prompt profile reader skipped ${directoryEntry.name}: ${error.message}`);
    }
  }

  return selectPromptProfile({
    profiles,
    request,
    readiness,
    brainReference,
    warnings,
  });
}

export {
  DEFAULT_PROMPT_PROFILE_ID,
  DEFAULT_PROMPT_STACK_VERSION_ID,
  PROMPT_PROFILE_FILE_NAME,
  PROMPT_PROFILE_ROOT_PATH,
  buildDefaultPromptProfile,
};
