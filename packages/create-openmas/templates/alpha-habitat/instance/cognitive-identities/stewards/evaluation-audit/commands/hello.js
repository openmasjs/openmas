export async function runDeterministicCommand({
  readiness,
}) {
  const operationalIdentityId = readiness?.operationalIdentityDefinition?.operationalIdentityId ?? 'bruce';
  const displayName = readiness?.operationalIdentityDefinition?.displayName ?? 'Bruce';

  return {
    message: `Hello. I am ${displayName}, the Evaluation and Audit Steward for this OpenMAS habitat. I am ready to review evidence and report grounded findings.`,
    reportKind: 'starter_evaluation_audit_hello_report',
    reportContent: [
      '# Starter Evaluation Audit Hello Report',
      '',
      `Operational Identity: ${operationalIdentityId}`,
      'Primary Cognitive Identity: evaluation-audit-steward',
      'Status: deterministic hello completed',
    ].join('\n'),
    outputPayload: {
      kind: 'starter_evaluation_audit_hello_output',
      version: 1,
      operationalIdentityId,
      cognitiveIdentityId: 'evaluation-audit-steward',
      deterministicReady: true,
    },
  };
}
