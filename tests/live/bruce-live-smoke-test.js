#!/usr/bin/env node

import process from 'node:process';
import {
  LIVE_CREDENTIAL_REFERENCE_IDS,
  assertCompletedAgentSmoke,
  printAgentSmokeSummary,
  printRequiredSecretReferenceStatus,
  readLiveCredentialVault,
  runLiveProbabilisticAgentTurn,
  runLiveSmokeMain,
} from './live-smoke-helpers.js';

async function main() {
  const label = 'OpenMAS Bruce Live Smoke Test';

  await runLiveSmokeMain(label, async () => {
    const requiredSecretReferenceIds = [
      LIVE_CREDENTIAL_REFERENCE_IDS.openRouterBruceDefault,
      LIVE_CREDENTIAL_REFERENCE_IDS.geminiSharedDefault,
    ];
    const credentials = await readLiveCredentialVault({
      requiredSecretReferenceIds,
    });

    printRequiredSecretReferenceStatus({
      credentials,
      requiredSecretReferenceIds,
    });

    const result = await runLiveProbabilisticAgentTurn({
      operationalIdentityId: 'bruce',
      requestedBy: 'live-smoke-bruce',
      inputText: 'Hola Bruce. In one short sentence, identify yourself as Bruce and confirm that the OpenMAS live smoke is running. Do not request tools.',
    });

    printAgentSmokeSummary(label, result);
    assertCompletedAgentSmoke(result, {
      operationalIdentityId: 'bruce',
      primaryCognitiveIdentityId: 'evaluation-audit-steward',
    });

    process.exitCode = 0;
  });
}

await main();
