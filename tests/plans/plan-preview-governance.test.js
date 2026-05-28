import test from 'node:test';
import assert from 'node:assert/strict';
import { governPlanPreviewOutput } from '../../src/invocation/govern-plan-preview-output.js';

function buildBrainOutput(overrides = {}) {
  return {
    kind: 'brain_output',
    version: 1,
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'chat_completion',
    outputText: '## Plan\n\n1. Review the MAS.\n2. Gather evidence.\n3. Summarize findings.',
    warnings: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function buildProviderResponse(overrides = {}) {
  return {
    kind: 'provider_response',
    version: 1,
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'chat_completion',
    status: 'completed',
    outputText: '## Plan\n\n1. Review the MAS.\n2. Gather evidence.\n3. Summarize findings.',
    warnings: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function buildPreviewExecutionPlan(overrides = {}) {
  return {
    kind: 'agent_execution_plan',
    version: 1,
    planId: 'plan-preview-001',
    goal: 'Preview a governed inspection path before execution.',
    steps: [],
    requiredTools: ['mas.system.inspect'],
    requiredWorkflows: [],
    requiredApprovals: [],
    metadata: {
      targetType: 'tool',
      targetId: 'mas.system.inspect',
      planMode: 'preview_only',
    },
    ...overrides,
  };
}

test('governPlanPreviewOutput downgrades ungoverned visible plans to a draft clarification message', () => {
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, me podrias ayudar con un Plan de Inspeccion?',
    },
    brainOutput: buildBrainOutput(),
    providerResponse: buildProviderResponse(),
    actionResolution: {
      status: 'needs_clarification',
      clarificationRequest: {
        question: 'Por favor acota la accion que quieres o nombra la herramienta o el flujo directamente.',
      },
    },
    executionPlan: {
      clarificationRequest: {
        question: 'Por favor acota la accion que quieres o nombra la herramienta o el flujo directamente.',
      },
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'ungoverned_plan_preview');
  assert.match(result.brainOutput.outputText, /borrador no verificado/i);
  assert.match(result.brainOutput.outputText, /Aclaracion necesaria/i);
  assert.equal(result.providerResponse.outputText, result.brainOutput.outputText);
});

test('governPlanPreviewOutput relocalizes English clarification questions for Spanish plan preview downgrades', () => {
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Bruce, me podrias ayudar con un plan de evaluacion y diagnostico del MAS?',
    },
    brainOutput: buildBrainOutput({
      outputText: '## Plan\n\n1. Revisar evidencia.\n2. Comparar politicas.\n3. Resumir hallazgos.',
    }),
    providerResponse: buildProviderResponse({
      outputText: '## Plan\n\n1. Revisar evidencia.\n2. Comparar politicas.\n3. Resumir hallazgos.',
    }),
    actionResolution: {
      status: 'needs_clarification',
      clarificationRequest: {
        reasonCategory: 'unsupported_request',
        question: 'I could not classify the requested action safely. Please restate the action or use an explicit tool/workflow request.',
        metadata: {
          optionHints: [],
          contextReferences: [],
        },
      },
    },
    executionPlan: {
      clarificationRequest: {
        reasonCategory: 'unsupported_request',
        question: 'I could not classify the requested action safely. Please restate the action or use an explicit tool/workflow request.',
        metadata: {
          optionHints: [],
          contextReferences: [],
        },
      },
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.match(result.brainOutput.outputText, /Aclaracion necesaria:/i);
  assert.match(result.brainOutput.outputText, /Por favor reformula la accion que quieres/i);
  assert.doesNotMatch(result.brainOutput.outputText, /I could not classify the requested action safely/i);
});

test('governPlanPreviewOutput preserves validated plan_only previews', () => {
  const originalBrainOutput = buildBrainOutput();
  const originalProviderResponse = buildProviderResponse();
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Please give me an inspection plan before acting.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: originalProviderResponse,
    actionResolution: {
      status: 'plan_only',
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, false);
  assert.equal(result.brainOutput.outputText, originalBrainOutput.outputText);
  assert.equal(result.providerResponse.outputText, originalProviderResponse.outputText);
});

test('governPlanPreviewOutput downgrades validated plan_only previews that claim execution without evidence', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      'He procesado tu solicitud y he realizado una inspeccion inicial del sistema.',
      '',
      '## Plan',
      '',
      '1. Revisar el inventario.',
      '2. Ejecutar el workflow de salud.',
      '3. Resumir hallazgos.',
    ].join('\n'),
  });
  const originalProviderResponse = buildProviderResponse({
    outputText: originalBrainOutput.outputText,
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, me podrias ayudar con un plan de inspeccion antes de ejecutar nada?',
    },
    brainOutput: originalBrainOutput,
    providerResponse: originalProviderResponse,
    actionResolution: {
      status: 'plan_only',
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_claimed_execution');
  assert.match(result.brainOutput.outputText, /borrador no verificado/i);
  assert.doesNotMatch(result.brainOutput.outputText, /he realizado una inspeccion inicial/i);
});

test('governPlanPreviewOutput downgrades validated plan_only previews that announce imminent execution', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      'Hola Miguel.',
      '',
      'Voy a ejecutar el flujo de diagnostico `mas-health-review` para obtener el estado actual del sistema.',
      '',
      '## Plan',
      '',
      '1. Revisar el inventario.',
      '2. Documentar hallazgos.',
    ].join('\n'),
  });
  const originalProviderResponse = buildProviderResponse({
    outputText: originalBrainOutput.outputText,
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion del MAS antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: originalProviderResponse,
    actionResolution: {
      status: 'plan_only',
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unsupported_affordance_references');
  assert.match(result.brainOutput.outputText, /borrador no verificado/i);
  assert.doesNotMatch(result.brainOutput.outputText, /Voy a ejecutar el flujo de diagnostico/u);
});

test('governPlanPreviewOutput downgrades validated plan_only previews that promise unsupported deliverables', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '## Plan de revision',
      '',
      '1. Preparar el audit_report.json.',
      '2. Comparar findings con evidence_gap_report.json.',
      '3. Guardar improvement_roadmap.md en instance/memory/artifacts/health-review-<timestamp>.json.',
    ].join('\n'),
  });
  const originalProviderResponse = buildProviderResponse({
    outputText: originalBrainOutput.outputText,
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan de revision antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: originalProviderResponse,
    actionResolution: {
      status: 'plan_only',
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unsupported_deliverables');
  assert.match(
    result.brainOutput.outputText,
    /(?:unverified draft|borrador no verificado)/i,
  );
  assert.doesNotMatch(result.brainOutput.outputText, /audit_report\.json/i);
});

test('governPlanPreviewOutput downgrades validated plan_only previews that leak a raw machine-readable request envelope', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '{',
      '  "kind": "brain_tool_request",',
      '  "version": 1,',
      '  "toolRequestId": "tool-request-001",',
      '  "toolId": "mas.system.inspect",',
      '  "input": {',
      '    "sections": ["overview", "tools"]',
      '  },',
      '  "purpose": "Preview only",',
      '  "expectedSideEffectLevel": "read_only"',
      '}',
    ].join('\n'),
  });
  const originalProviderResponse = buildProviderResponse({
    outputText: originalBrainOutput.outputText,
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan de evaluacion antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: originalProviderResponse,
    actionResolution: {
      status: 'plan_only',
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_raw_envelope');
  assert.match(result.brainOutput.outputText, /borrador no verificado/i);
  assert.doesNotMatch(result.brainOutput.outputText, /brain_tool_request/i);
});

test('governPlanPreviewOutput rewrites raw validated plan_only envelopes into a governed preview when runtime target data is available', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '{',
      '  "kind": "brain_tool_request",',
      '  "version": 1,',
      '  "toolRequestId": "tool-request-001",',
      '  "toolId": "mas.system.inspect",',
      '  "input": {',
      '    "sections": ["overview"]',
      '  },',
      '  "purpose": "Preview only",',
      '  "expectedSideEffectLevel": "read_only"',
      '}',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan de evaluacion antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_raw_envelope');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /mas\.system\.inspect/i);
  assert.match(result.brainOutput.outputText, /plan_only/i);
  assert.doesNotMatch(result.brainOutput.outputText, /brain_tool_request/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput downgrades validated plan_only previews that overclaim runtime evidence', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '## Action Audit Record',
      '',
      '### Runtime-Resolved Evidence',
      '- Machine state: active',
      '- Recent tool activity: mas.system.inspect shows normal operation status.',
      '- No permission gaps detected for the supplied modalities.',
      '',
      '### Expected Output',
      '- Registered Identities: 3',
      '- Inspection Timestamp: 2026-05-08 14:56:10',
      '- Confidence Score: 98/100',
    ].join('\n'),
  });
  const originalProviderResponse = buildProviderResponse({
    outputText: originalBrainOutput.outputText,
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: originalProviderResponse,
    actionResolution: {
      status: 'plan_only',
    },
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unverified_runtime_evidence');
  assert.match(result.brainOutput.outputText, /borrador no verificado/i);
  assert.doesNotMatch(result.brainOutput.outputText, /Runtime-Resolved Evidence|Confidence Score|Inspection Timestamp/i);
});

test('governPlanPreviewOutput rewrites overclaimed validated plan_only previews into a governed preview when runtime target data is available', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '## Action Audit Record',
      '',
      '### Runtime-Resolved Evidence',
      '- Machine state: active',
      '- Recent tool activity: mas.system.inspect shows normal operation status.',
      '',
      '### Expected Output',
      '- Confidence Score: 98/100',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unverified_runtime_evidence');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /No se ejecuto ninguna accion/i);
  assert.doesNotMatch(result.brainOutput.outputText, /Runtime-Resolved Evidence|Confidence Score/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput rewrites theatrical plan_only previews that overclaim runtime grounding into a governed preview', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '**ALFRED ALBERTO (System Steward)**',
      '*Response Contains Evident Resolve and Prepared Action*',
      '',
      '### **Plan Components (Grounded in Runtime Evidence)**',
      '1. Inventory active licenses, pending approvals, and pending workflows.',
      '2. Flag tools with highest readiness scores for immediate attention.',
      '',
      '### **Constraints Observed (Runtime Governance)**',
      '- Evidence is derived from `mas.system.inspect`.',
      '- Ensure phrasing aligns with `mas-warning-templates` documentation.',
      '',
      '**Final Note**: This plan aligns with policy 1 and ensures audit transparency.',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion del MAS antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unverified_runtime_evidence');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /mas\.system\.inspect/i);
  assert.match(result.brainOutput.outputText, /No se ejecuto ninguna accion/i);
  assert.doesNotMatch(result.brainOutput.outputText, /Grounded in Runtime Evidence|readiness scores|mas-warning-templates|policy 1/i);
  assert.doesNotMatch(result.brainOutput.outputText, /ALFRED ALBERTO|Prepared Action/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput rewrites validated plan_only previews that sound like immediate tool requests into a governed preview', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '**Observed fact**',
      '- The user requests a new plan.',
      '',
      '**Recommendation / Next step**',
      '1. Request execution of `mas.system.inspect`.',
      '2. Compose the detailed plan from the tool output.',
      '',
      'I will now request the tool to gather the required data.',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion del MAS antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_claimed_execution');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.doesNotMatch(result.brainOutput.outputText, /I will now request the tool/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput rewrites validated plan_only previews when visible content drifts away from the runtime-selected target', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '## Plan de inspeccion',
      '',
      '1. Empezar con el workflow `mas-health-review` para revisar el estado global.',
      '2. Resumir hallazgos iniciales.',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion del MAS antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unsupported_affordance_references');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /mas\.system\.inspect/i);
  assert.doesNotMatch(result.brainOutput.outputText, /mas-health-review/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput rewrites validated plan_only previews that introduce extra MAS affordances beyond the governed target set', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '### Plan de Inspeccion Provisorio',
      '',
      '1. Usar `mas.system.inspect` para obtener el panorama general.',
      '2. Usar `mas.operationalIdentities.inspect` para revisar identidades activas.',
      '3. Usar `mas.tools.inspect` para revisar herramientas disponibles.',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan de inspeccion del MAS antes de ejecutar nada.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unsupported_affordance_references');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /mas\.system\.inspect/i);
  assert.doesNotMatch(result.brainOutput.outputText, /mas\.operationalIdentities\.inspect|mas\.tools\.inspect/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput rewrites short validated plan_only previews that propose a workflow outside the governed target', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      'Tengo disponible el workflow de diagnostico `mas-health-review`, que realiza una inspeccion completa del estado del sistema de forma segura y sin efectos secundarios.',
      '',
      '¿Te gustaria que lo ejecute ahora?',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Gracias Alfred! Me gustaria que me ayudaras nuevamente con el Plan de Inspeccion del MAS.',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_unsupported_affordance_references');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /mas\.system\.inspect/i);
  assert.doesNotMatch(result.brainOutput.outputText, /mas-health-review/i);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});

test('governPlanPreviewOutput rewrites validated plan_only previews that leak pseudo tool-call markup and execution wording', () => {
  const originalBrainOutput = buildBrainOutput({
    outputText: [
      '¡Hola Miguel! Con gusto te ayudo con el Plan de Inspeccion del MAS. Voy a realizar una inspeccion completa del sistema para darte un reporte actualizado.',
      '',
      'Primero, ejecutare la herramienta de inspeccion del sistema MAS:',
      '<tool_call>mas.system.inspect',
      '{"sections":["overview","cognitiveIdentities","resources"]}',
    ].join('\n'),
  });
  const result = governPlanPreviewOutput({
    request: {
      originalInput: 'Gracias Alfred! Me gustaria que me ayudaras nuevamente con el Plan de Inspeccion del MAS!',
    },
    brainOutput: originalBrainOutput,
    providerResponse: buildProviderResponse({
      outputText: originalBrainOutput.outputText,
    }),
    actionResolution: {
      status: 'plan_only',
      selectedCandidate: {
        kind: 'action_candidate',
        version: 1,
        candidateId: 'candidate-001',
        actionType: 'tool_execution',
        targetType: 'tool',
        targetId: 'mas.system.inspect',
        reason: 'Safe read-only inspection target.',
        confidence: 'high',
        sideEffectLevel: 'read_only',
        requiresApproval: false,
        warnings: [],
        metadata: {},
      },
    },
    executionPlan: buildPreviewExecutionPlan(),
    planExecutionCoordination: {
      status: 'no_execution',
    },
    brainToolExecution: {
      executionPerformed: false,
    },
    brainWorkflowExecution: {
      executionPerformed: false,
    },
  });

  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'plan_preview_raw_envelope');
  assert.match(result.brainOutput.outputText, /plan gobernado de solo lectura/i);
  assert.match(result.brainOutput.outputText, /mas\.system\.inspect/i);
  assert.doesNotMatch(result.brainOutput.outputText, /<tool_call>|ejecutare la herramienta|voy a realizar una inspeccion/u);
  assert.doesNotMatch(result.brainOutput.outputText, /borrador no verificado/i);
});
