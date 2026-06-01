function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertIdentityCommandExecutionOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object') {
    throw new Error('Identity command execution outcome must be an object.');
  }

  if (!isNonEmptyString(outcome.message)) {
    throw new Error('Identity command execution outcome must include a non-empty message.');
  }

  if (!isNonEmptyString(outcome.reportKind)) {
    throw new Error('Identity command execution outcome must include a non-empty reportKind.');
  }

  if (!isNonEmptyString(outcome.reportContent)) {
    throw new Error('Identity command execution outcome must include a non-empty reportContent.');
  }

  if (!outcome.outputPayload || typeof outcome.outputPayload !== 'object' || Array.isArray(outcome.outputPayload)) {
    throw new Error('Identity command execution outcome must include an object outputPayload.');
  }

  return {
    message: outcome.message,
    reportKind: outcome.reportKind,
    reportContent: outcome.reportContent,
    outputPayload: outcome.outputPayload,
  };
}
