export async function runDeterministicCommand({
  readiness,
}) {
  const operationalIdentityId = readiness?.operationalIdentityDefinition?.operationalIdentityId ?? 'alfred';
  const displayName = readiness?.operationalIdentityDefinition?.displayName ?? 'Alfred';

  return {
    message: `Hello. I am ${displayName}, the System Steward for this OpenMAS habitat. The deterministic runtime is alive and ready for first inspection.`,
    reportKind: 'starter_system_steward_hello_report',
    reportContent: [
      '# Starter System Steward Hello Report',
      '',
      `Operational Identity: ${operationalIdentityId}`,
      'Primary Cognitive Identity: system-steward',
      'Status: deterministic hello completed',
    ].join('\n'),
    outputPayload: {
      kind: 'starter_system_steward_hello_output',
      version: 1,
      operationalIdentityId,
      cognitiveIdentityId: 'system-steward',
      deterministicReady: true,
    },
  };
}
