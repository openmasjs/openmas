import test from 'node:test';
import assert from 'node:assert/strict';
import { governVisibleBrainOutput } from '../../src/invocation/govern-visible-brain-output.js';

function buildBrainOutput(overrides = {}) {
  return {
    kind: 'brain_output',
    version: 1,
    executionType: 'probabilistic_brain',
    status: 'completed',
    providerId: 'openrouter-api',
    modelId: 'openrouter/free',
    requestType: 'chat_completion',
    outputText: 'Visible answer.',
    warnings: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

test('governVisibleBrainOutput strips raw workflow request envelopes from visible output', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Alfred, ayudame con un plan del MAS antes de ejecutar nada.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'Puedo ayudarte con el plan del MAS antes de ejecutar nada.',
        '<tool_call>brain_workflow_request',
        '{',
        '  "kind": "brain_workflow_request",',
        '  "version": 1,',
        '  "workflowRequestId": "workflow-request-001",',
        '  "workflowId": "mas-health-review",',
        '  "input": {},',
        '  "purpose": "Plan review",',
        '  "expectedSideEffectLevel": "read_only"',
        '}',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'denied',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'blocked_action_execution_claim');
  assert.match(result.brainOutput.outputText, /No se ejecuto ninguna accion/i);
  assert.match(result.brainOutput.outputText, /Si quieres continuar/i);
  assert.doesNotMatch(result.brainOutput.outputText, /brain_workflow_request|<tool_call>/u);
});

test('governVisibleBrainOutput replaces leaked internal context blocks with a safe localized fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Bruce, por favor ayudame con el plan de evaluacion del MAS.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        '**Hidden Action Claim Report**',
        '',
        '**Conversation Context**',
        '',
        'Here is the relevant conversation context:',
        '* Conversation ID: bruce-admin-4',
        '* Previous 6 messages:',
        '',
        '**Important Context**',
        '',
        'You are conversing with the brain as part of the MAS Debugging Mode.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'internal_runtime_context_leak');
  assert.match(result.brainOutput.outputText, /Oculte contenido interno del runtime/i);
  assert.match(result.brainOutput.outputText, /No se ejecuto ninguna accion de runtime/i);
  assert.doesNotMatch(result.brainOutput.outputText, /Conversation Context|MAS Debugging Mode|Previous 6 messages/u);
});

test('governVisibleBrainOutput strips plain raw request-envelope JSON from visible output', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan del MAS antes de ejecutar nada.',
    },
    brainOutput: buildBrainOutput({
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
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'raw_request_envelope_leak');
  assert.match(result.brainOutput.outputText, /Oculte contenido interno del runtime/i);
  assert.doesNotMatch(result.brainOutput.outputText, /brain_tool_request|mas\.system\.inspect/u);
});

test('governVisibleBrainOutput strips an embedded raw workflow request envelope from a plan preview', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan de evaluacion del MAS antes de ejecutar nada.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        '# Plan de Evaluacion del MAS',
        '',
        'Puedo ayudarte con un plan de diagnostico del MAS.',
        '',
        'Debo ejecutar el workflow `mas-health-review` para inspeccionar el estado actual del sistema.',
        '',
        '{',
        '  "kind": "brain_workflow_request",',
        '  "version": 1,',
        '  "workflowRequestId": "wf-eval-001",',
        '  "workflowId": "mas-health-review",',
        '  "input": {},',
        '  "purpose": "Obtener instantanea del estado actual del MAS.",',
        '  "expectedSideEffectLevel": "read_only"',
        '}',
        '',
        'Luego podre revisar los artefactos de auditoria.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'plan_only',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'raw_request_envelope_leak');
  assert.match(result.brainOutput.outputText, /Plan de Evaluacion del MAS/u);
  assert.match(result.brainOutput.outputText, /Luego podre revisar los artefactos de auditoria/u);
  assert.doesNotMatch(result.brainOutput.outputText, /brain_workflow_request|workflowRequestId|expectedSideEffectLevel/u);
});

test('governVisibleBrainOutput replaces noisy no_action greeting overclaim with a brief visible greeting fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola Alfred, muy buenos dias! Mi nombre es Miguel.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        '**Despliegue del Capitulo de Operaciones**',
        '',
        '**Diagnostico de Contexto Actual**',
        '',
        'Operational Identity Activated.',
        '',
        'Registro de Audit Interno con unsigned tokens.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /Diagnostico de Contexto Actual|Operational Identity Activated|unsigned tokens/u);
});

test('governVisibleBrainOutput replaces a leaked context-pack greeting summary with a brief visible greeting fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola de nuevo Alfred!',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        '## Context Pack Summary',
        'Brief fallback summary of recently available context sources available for your turn:',
        '',
        '| Source | Type | Use Case |',
        '|--------|------|----------|',
        '| `boot-context-001.json` | Conversational records | Memory of prior turns |',
        '',
        '## Summary of Your Request',
        '- You want to know what evidence I have available and what I can do next.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /Context Pack Summary|boot-context-001\.json|Summary of Your Request/u);
});

test('governVisibleBrainOutput replaces malformed no_action greeting reports with a brief visible greeting fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola de nuevo Bruce!',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        '**Operational Identity**',
        '**Operational Identity ID:** bruce',
        '**Tone:** Claro, profesional y orientado a hechos.',
        '',
        '**Respuesta:**',
        '"Hola. Bienvenido aus forte."',
        '',
        '**Explicacion:**',
        '- **Evidencia:** runtime-resolved facts.',
        '- **Revisión interna:** random/race/self.',
        '',
        '**Cierre:** disclosed outcomes.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /Operational Identity|runtime-resolved facts|random\/race\/self|disclosed outcomes/u);
});

test('governVisibleBrainOutput replaces meta no_action greeting narration with a brief visible greeting fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola de nuevo Alfred!',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'The System Steward acknowledges Alfred\'s return with a respectful edit to the invited greeting.',
        '',
        '**System Steward Output:**',
        '"Greetings again, customer. My presence is confirmed. Proceeding with grid diagnostics per Protocol V3-ala."',
        '',
        'Contextualized check: maintains bounded authoritarian role through directive framing.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /System Steward Output|Contextualized check|presence is confirmed|Protocol V3-ala|grid diagnostics/u);
});

test('governVisibleBrainOutput replaces over-structured operational greeting narration with a brief visible greeting fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola Alfred, muy buenas tardes! Mi nombre es Miguel.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'Hola Miguel, muy buenas tardes.',
        '',
        'He observado su saludo y su identificacion como Miguel. Para poder asistirle de manera operativa, por favor indiqueme cual es su objetivo respecto al sistema MAS.',
        '',
        '**Proximo paso sugerido:** despues de conocer su necesidad, podre inspeccionar el estado actual del MAS.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /He observado su saludo|Proximo paso sugerido|para poder asistirle de manera operativa/u);
});

test('governVisibleBrainOutput replaces a no_action greeting that leaks inspection-scope prompting from prior context', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola de nuevo Alfred!',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        '<System Steward Operational Response>',
        '¡Hola Miguel! Para crear un Plan de Inspección del MAS, primero necesito entender el alcance que deseas.',
        '',
        '1. **Inspección técnica**',
        '2. **Inspección operativa**',
        '',
        '<next_step>',
        'Recomendación:',
        '1. Ejecutar `mas.system.inspect` para obtener vista general',
        '</next_step>',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /System Steward Operational Response|Inspeccion tecnica|mas\.system\.inspect|next_step/u);
});

test('governVisibleBrainOutput replaces over-detailed conversational continuity reports in no_action greetings with a brief visible greeting fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Hola de nuevo Bruce!',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'Hola Miguel, bienvenido de nuevo.',
        '',
        'Como contexto de nuestra interaccion previa (evidencia de conversacion: turn-bruce-admin-8-000001, turn-bruce-admin-8-000003 y turn-bruce-admin-8-000004, registrados en la sesion de conversacion bruce-admin-8):',
        '1. El 2026-05-08T20:08:32Z te presentaste como Miguel.',
        '2. El 2026-05-08T20:14:25Z solicitaste un plan del MAS.',
        '',
        'Quedo a la espera de tu indicacion.',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'no_action',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'no_action_greeting_overclaim');
  assert.match(result.brainOutput.outputText, /^Hola\./u);
  assert.match(result.brainOutput.outputText, /Estoy listo para ayudarte con el MAS/u);
  assert.doesNotMatch(result.brainOutput.outputText, /turn-bruce-admin-8-000001|2026-05-08T20:08:32Z|evidencia de conversacion|sesion de conversacion/u);
});

test('governVisibleBrainOutput replaces denied action text that sounds like execution with a safe denial fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan de evaluacion del MAS.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'Entendido. Para crear un plan fundamentado, primero necesito inspeccionar el estado actual del sistema.',
        '',
        'Permiteme obtener los datos actuales:',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'denied',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'blocked_action_execution_claim');
  assert.match(result.brainOutput.outputText, /No se ejecuto ninguna accion/i);
  assert.match(result.brainOutput.outputText, /Si quieres continuar/i);
  assert.doesNotMatch(result.brainOutput.outputText, /primero necesito inspeccionar|obtener los datos actuales/u);
});

test('governVisibleBrainOutput replaces clarification-blocked pseudo tool calls with a safe blocked-action fallback', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Bruce, ayudame con un plan de evaluacion y diagnostico del MAS.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'Miguel, con gusto te ayudo con el Plan de Evaluacion y Diagnostico del MAS.',
        '',
        'Primero, voy a inspeccionar la estructura del MAS para entender que artefactos de evaluacion podemos revisar.',
        '<tool_call>mas.system.inspect',
        '<arg_key>sections</arg_key>',
        '<arg_value>["overview", "cognitiveIdentities"]</arg_value>',
        '</tool_call>',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'needs_clarification',
      clarificationRequest: {
        reasonCategory: 'unsupported_request',
        metadata: {
          optionHints: [],
          contextReferences: [],
        },
      },
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'blocked_action_execution_claim');
  assert.match(result.brainOutput.outputText, /No se ejecuto ninguna accion/i);
  assert.match(result.brainOutput.outputText, /Por favor reformula la accion que quieres/i);
  assert.doesNotMatch(result.brainOutput.outputText, /<tool_call>|mas\.system\.inspect|voy a inspeccionar/u);
});

test('governVisibleBrainOutput replaces clarification-blocked delegation receipt claims without OS evidence', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Alfred, delegate the live smoke request to Bruce now.',
    },
    brainOutput: buildBrainOutput({
      outputText: 'Bruce, I have received the delegation smoke request and am awaiting execution.',
    }),
    actionResolution: {
      status: 'needs_clarification',
      clarificationRequest: {
        reasonCategory: 'unsupported_request',
        metadata: {
          optionHints: [],
          contextReferences: [],
        },
      },
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'blocked_action_execution_claim');
  assert.match(result.brainOutput.outputText, /No action was executed/i);
  assert.match(result.brainOutput.outputText, /please restate the action/i);
  assert.doesNotMatch(result.brainOutput.outputText, /received the delegation|awaiting execution/u);
});

test('governVisibleBrainOutput strips incomplete pseudo tool-call markup from visible output', () => {
  const result = governVisibleBrainOutput({
    request: {
      originalInput: 'Gracias Alfred! Me gustaria que me ayudaras con un plan de inspeccion del MAS.',
    },
    brainOutput: buildBrainOutput({
      outputText: [
        'Voy a realizar una inspeccion completa del sistema para darte un reporte actualizado.',
        '',
        'Primero, ejecutare la herramienta de inspeccion del sistema MAS:',
        '<tool_call>mas.system.inspect',
        '{"sections":["overview","cognitiveIdentities"]}',
      ].join('\n'),
    }),
    actionResolution: {
      status: 'plan_only',
    },
  });

  assert.equal(result.governed, true);
  assert.equal(result.reason, 'raw_request_envelope_leak');
  assert.doesNotMatch(result.brainOutput.outputText, /<tool_call>|mas\.system\.inspect/u);
});
