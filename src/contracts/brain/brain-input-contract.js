function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertStringArray(values, description) {
  if (!Array.isArray(values)) {
    throw new Error(`${description} must be an array.`);
  }

  return values.map((value, index) => {
    if (!isNonEmptyString(value)) {
      throw new Error(`${description}[${index}] must be a non-empty string.`);
    }

    return value.trim();
  });
}

function assertPersona(persona) {
  if (persona === null || persona === undefined) {
    return null;
  }

  if (!persona || typeof persona !== 'object' || Array.isArray(persona)) {
    throw new Error('Brain Input persona must be an object when provided.');
  }

  const normalizedPersona = {};

  if (isNonEmptyString(persona.tone)) {
    normalizedPersona.tone = persona.tone.trim();
  }

  if (isNonEmptyString(persona.presentationStyle)) {
    normalizedPersona.presentationStyle = persona.presentationStyle.trim();
  }

  return Object.keys(normalizedPersona).length > 0 ? normalizedPersona : null;
}

function assertCognitiveIdentityContext(context, description) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error(`${description} must be an object.`);
  }

  if (!isNonEmptyString(context.cognitiveIdentityId)) {
    throw new Error(`${description} must include a non-empty cognitiveIdentityId.`);
  }

  if (!isNonEmptyString(context.identityText)) {
    throw new Error(`${description} must include non-empty identityText.`);
  }

  if (!isNonEmptyString(context.policiesText)) {
    throw new Error(`${description} must include non-empty policiesText.`);
  }

  if (!isNonEmptyString(context.capabilitiesText)) {
    throw new Error(`${description} must include non-empty capabilitiesText.`);
  }

  return {
    cognitiveIdentityId: context.cognitiveIdentityId.trim(),
    identityText: context.identityText.trim(),
    policiesText: context.policiesText.trim(),
    capabilitiesText: context.capabilitiesText.trim(),
  };
}

function assertBrainInputMessage(message, index) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error(`Brain Input messages[${index}] must be an object.`);
  }

  if (!isNonEmptyString(message.role)) {
    throw new Error(`Brain Input messages[${index}] must include a non-empty role.`);
  }

  if (!isNonEmptyString(message.content)) {
    throw new Error(`Brain Input messages[${index}] must include non-empty content.`);
  }

  return {
    role: message.role.trim(),
    content: message.content.trim(),
  };
}

export function assertBrainInput(brainInput) {
  if (!brainInput || typeof brainInput !== 'object' || Array.isArray(brainInput)) {
    throw new Error('Brain Input must be an object.');
  }

  if (!isNonEmptyString(brainInput.providerId)) {
    throw new Error('Brain Input must include a non-empty providerId.');
  }

  if (!isNonEmptyString(brainInput.modelId)) {
    throw new Error('Brain Input must include a non-empty modelId.');
  }

  if (!isNonEmptyString(brainInput.primaryCognitiveIdentityId)) {
    throw new Error('Brain Input must include a non-empty primaryCognitiveIdentityId.');
  }

  if (!isNonEmptyString(brainInput.systemInstructions)) {
    throw new Error('Brain Input must include non-empty systemInstructions.');
  }

  if (!isNonEmptyString(brainInput.userInput)) {
    throw new Error('Brain Input must include non-empty userInput.');
  }

  if (!Array.isArray(brainInput.messages) || brainInput.messages.length === 0) {
    throw new Error('Brain Input must include a non-empty messages array.');
  }

  return {
    kind: 'brain_input',
    promptProfileId: isNonEmptyString(brainInput.promptProfileId)
      ? brainInput.promptProfileId.trim()
      : null,
    promptStackVersionId: isNonEmptyString(brainInput.promptStackVersionId)
      ? brainInput.promptStackVersionId.trim()
      : null,
    operationalIdentityId: isNonEmptyString(brainInput.operationalIdentityId)
      ? brainInput.operationalIdentityId.trim()
      : null,
    operationalDisplayName: isNonEmptyString(brainInput.operationalDisplayName)
      ? brainInput.operationalDisplayName.trim()
      : null,
    persona: assertPersona(brainInput.persona),
    providerId: brainInput.providerId.trim(),
    modelId: brainInput.modelId.trim(),
    primaryCognitiveIdentityId: brainInput.primaryCognitiveIdentityId.trim(),
    secondaryCognitiveIdentityIds: assertStringArray(
      brainInput.secondaryCognitiveIdentityIds ?? [],
      'Brain Input secondaryCognitiveIdentityIds',
    ),
    primaryCognitiveIdentity: assertCognitiveIdentityContext(
      brainInput.primaryCognitiveIdentity,
      'Brain Input primaryCognitiveIdentity',
    ),
    secondaryCognitiveIdentities: Array.isArray(brainInput.secondaryCognitiveIdentities)
      ? brainInput.secondaryCognitiveIdentities.map((entry, index) => {
        return assertCognitiveIdentityContext(
          entry,
          `Brain Input secondaryCognitiveIdentities[${index}]`,
        );
      })
      : (() => {
        throw new Error('Brain Input secondaryCognitiveIdentities must be an array.');
      })(),
    command: isNonEmptyString(brainInput.command) ? brainInput.command.trim() : 'status',
    requestedBy: isNonEmptyString(brainInput.requestedBy) ? brainInput.requestedBy.trim() : 'system',
    inputText: typeof brainInput.inputText === 'string' ? brainInput.inputText : '',
    systemInstructions: brainInput.systemInstructions.trim(),
    userInput: brainInput.userInput.trim(),
    assistantPrimer: isNonEmptyString(brainInput.assistantPrimer)
      ? brainInput.assistantPrimer.trim()
      : null,
    messages: brainInput.messages.map((message, index) => {
      return assertBrainInputMessage(message, index);
    }),
  };
}
