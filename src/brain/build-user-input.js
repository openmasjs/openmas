export function buildUserInput({
  request,
  activeCognitiveSet,
}) {
  const lines = [
    `Invocation Command: ${request.command}`,
    `Requested By: ${request.requestedBy}`,
  ];

  if (activeCognitiveSet?.primaryCognitiveIdentityId) {
    lines.push(`Primary Cognitive Identity: ${activeCognitiveSet.primaryCognitiveIdentityId}`);
  }

  if (Array.isArray(activeCognitiveSet?.secondaryCognitiveIdentityIds) && activeCognitiveSet.secondaryCognitiveIdentityIds.length > 0) {
    lines.push(`Secondary Cognitive Identities: ${activeCognitiveSet.secondaryCognitiveIdentityIds.join(', ')}`);
  }

  const normalizedInputText = typeof request.inputText === 'string' ? request.inputText.trim() : '';

  if (normalizedInputText.length > 0) {
    lines.push('');
    lines.push('User Input:');
    lines.push(normalizedInputText);
  } else {
    lines.push('');
    lines.push('User Input:');
    lines.push('No explicit inputText was provided. Respond according to the invocation command and the active identity context.');
  }

  return lines.join('\n');
}
