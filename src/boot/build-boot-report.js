function formatList(items) {
  if (!items || items.length === 0) {
    return '- none';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

export function buildBootReport({
  bootId,
  status,
  projectRootPath,
  masRootPath,
  warnings,
  errors,
  nextStep,
  invocationReadiness,
  projectValidation,
  masValidation,
  startedAt,
  finishedAt,
}) {
  return [
    '# OpenMAS System Boot Report',
    '',
    `- Boot ID: ${bootId}`,
    `- Status: ${status}`,
    `- Project Root: ${projectRootPath ?? 'unresolved'}`,
    `- MAS Root: ${masRootPath ?? 'unresolved'}`,
    `- Invocation Ready: ${invocationReadiness.allowed ? 'yes' : 'no'}`,
    `- Invocation Reason: ${invocationReadiness.reason}`,
    `- Started At: ${startedAt}`,
    `- Finished At: ${finishedAt}`,
    '',
    '## Project Validation',
    '',
    `- Present Components: ${(projectValidation?.presentComponents ?? []).join(', ') || 'none'}`,
    `- Missing Required Components: ${(projectValidation?.missingRequiredComponents ?? []).join(', ') || 'none'}`,
    `- Missing Optional Components: ${(projectValidation?.missingOptionalComponents ?? []).join(', ') || 'none'}`,
    '',
    '## MAS Validation',
    '',
    `- Present Components: ${(masValidation?.presentComponents ?? []).join(', ') || 'none'}`,
    `- Missing Required Components: ${(masValidation?.missingRequiredComponents ?? []).join(', ') || 'none'}`,
    '',
    '## Warnings',
    '',
    formatList(warnings),
    '',
    '## Errors',
    '',
    formatList(errors),
    '',
    '## Next Step',
    '',
    nextStep,
  ].join('\n');
}
