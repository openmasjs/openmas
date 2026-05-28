import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenMasOsContextInstructionContent,
  buildOpenMasOsContextLayer,
} from '../../src/brain/build-openmas-os-context-layer.js';
import {
  buildOpenMasOsDelegationInstructionContent,
} from '../../src/brain/build-openmas-os-delegation-layer.js';

function buildOsRuntimeContext(overrides = {}) {
  return {
    jobId: 'job-parent-001',
    processId: 'process-parent-001',
    threadId: 'thread-parent-001',
    parentProcessId: null,
    ...overrides,
  };
}

test('OpenMAS OS context layer teaches exact immediate and scheduled delegation envelopes', () => {
  const content = buildOpenMasOsContextInstructionContent({
    osRuntimeContext: buildOsRuntimeContext(),
    conversationId: 'alfred-admin',
  });

  assert.match(content, /For mas\.os\.delegate, emit a brain_tool_request/iu);
  assert.match(content, /Use mas\.os\.delegate only when another Operational Identity should perform the delegated task now/iu);
  assert.match(content, /"toolId": "mas\.os\.delegate"/u);
  assert.match(content, /"parentContext": \{\s+"jobId": "job-parent-001"/u);
  assert.match(content, /"conversationId": "alfred-admin"/u);
  assert.match(content, /Emit at most one brain_tool_request envelope/iu);
  assert.match(content, /examples below are alternatives; never output both envelopes/iu);

  assert.match(content, /For mas\.os\.schedule_delegation, emit a brain_tool_request/iu);
  assert.match(content, /one-shot delegated task later at an explicit time/iu);
  assert.match(content, /"toolId": "mas\.os\.schedule_delegation"/u);
  assert.match(content, /"runAt": "2026-05-21T18:00:00-05:00"/u);
  assert.match(content, /"missedRunPolicy": "delay"/u);
  assert.match(content, /The runAt field must be an explicit ISO timestamp with timezone/iu);
  assert.match(content, /do not put mas\.os\.schedule_delegation in the child command field/iu);
  assert.match(content, /communication is asynchronous/iu);
  assert.match(content, /Never claim that delegated or scheduled child work completed unless a child Result Record is present/iu);
  assert.match(content, /work is scheduled, never that the scheduled child has already executed or completed/iu);
});

test('OpenMAS OS context layer stays unavailable without executable parent context', () => {
  assert.equal(
    buildOpenMasOsContextLayer({
      osRuntimeContext: {
        jobId: 'job-parent-001',
        processId: 'process-parent-001',
        threadId: '',
      },
    }),
    null,
  );
});

test('OpenMAS OS delegation context distinguishes immediate and scheduled authorized paths', () => {
  const content = buildOpenMasOsDelegationInstructionContent({
    allowedDelegationTargets: [
      {
        ruleId: 'alfred-to-bruce',
        target: {
          operationalIdentityId: 'bruce',
          displayName: 'Bruce',
          lifecycleState: 'active',
          roleLabel: 'MAS Architect',
          attachedCognitiveIdentityIds: [
            'mas-architect',
          ],
          operationalScope: [
            'architecture',
          ],
        },
        actionTypes: [
          'delegate',
          'schedule_delegation',
        ],
        commands: [
          'ask',
        ],
        modes: [
          'probabilistic',
        ],
        description: 'Alfred may delegate MAS review work to Bruce.',
      },
    ],
  });

  assert.match(content, /Operational Identity ID: bruce/u);
  assert.match(content, /requesting mas\.os\.delegate is an allowed AI-native path/iu);
  assert.match(content, /requesting mas\.os\.schedule_delegation is the allowed AI-native path/iu);
  assert.match(content, /Choose exactly one OS tool request, never both/iu);
  assert.match(content, /Delegation is asynchronous/iu);
  assert.match(content, /Only report target completion when runtime evidence includes its completed child Result Record/iu);
  assert.match(content, /use the exact ISO timestamp with timezone/iu);
});
