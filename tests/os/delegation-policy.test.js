import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { buildFakeOpenRouterSecretProbe } from '../helpers/fake-secret-probes.js';
import {
  OPENMAS_OS_ACTION_KINDS,
} from '../../src/contracts/os/openmas-os-action-request-contract.js';
import {
  assertDelegationPolicy,
} from '../../src/contracts/os/delegation-policy-contract.js';
import {
  evaluateOsActionRequest,
} from '../../src/os/actions/os-action-gate.js';
import {
  DEFAULT_DELEGATION_POLICY_ROOT_PATH,
  evaluateDelegationPolicy,
  getDelegationPolicyAllowedRequesters,
  readDelegationPolicy,
} from '../../src/os/delegation/delegation-policy.js';

const NOW = '2026-05-15T10:00:00-05:00';

function createPolicy(overrides = {}) {
  return {
    kind: 'openmas_delegation_policy',
    version: 1,
    defaultEffect: 'deny',
    rules: [
      {
        ruleId: 'allow-alfred-to-bruce-probabilistic-ask',
        effect: 'allow',
        fromOperationalIdentityId: 'alfred',
        toOperationalIdentityId: 'bruce',
        actionTypes: ['delegate', 'schedule_delegation'],
        commands: ['ask'],
        modes: ['probabilistic'],
        description: 'Allows Alfred to delegate governed MAS work to Bruce.',
      },
    ],
    ...overrides,
  };
}

function createDelegateRequest(overrides = {}) {
  return {
    kind: OPENMAS_OS_ACTION_KINDS.request,
    schemaVersion: 1,
    actionRequestId: 'os_action_request_delegate_policy_001',
    actionType: 'delegate',
    requestedBy: {
      type: 'operational_identity',
      id: 'alfred',
    },
    conversationId: 'os-m2-delegation-policy',
    parentContext: {
      jobId: 'job_alfred_parent',
      processId: 'process_alfred_parent',
      threadId: 'thread_alfred_parent',
    },
    payload: {
      targetOperationalIdentityId: 'bruce',
      task: 'Inspect the MAS and report findings.',
      command: 'ask',
      mode: 'probabilistic',
    },
    createdAt: NOW,
    ...overrides,
  };
}

async function createProjectFixture({ includePolicy = true, policy = createPolicy() } = {}) {
  const temporaryRootPath = await mkdtemp(path.join(os.tmpdir(), 'openmas-delegation-policy-'));
  const registryPath = path.join(temporaryRootPath, 'instance', 'registries');

  await mkdir(registryPath, { recursive: true });

  if (includePolicy) {
    await writeFile(
      path.join(registryPath, 'delegation-policy.json'),
      JSON.stringify(policy, null, 2),
      'utf8',
    );
  }

  return temporaryRootPath;
}

test('assertDelegationPolicy accepts an explicit Alfred to Bruce allow rule', () => {
  const policy = assertDelegationPolicy(createPolicy());

  assert.equal(policy.kind, 'openmas_delegation_policy');
  assert.equal(policy.defaultEffect, 'deny');
  assert.equal(policy.rules.length, 1);
  assert.equal(policy.rules[0].ruleId, 'allow-alfred-to-bruce-probabilistic-ask');
  assert.deepEqual(policy.rules[0].fromOperationalIdentityIds, ['alfred']);
  assert.deepEqual(policy.rules[0].toOperationalIdentityIds, ['bruce']);
  assert.deepEqual(policy.rules[0].actionTypes, ['delegate', 'schedule_delegation']);
});

test('assertDelegationPolicy rejects duplicate rules, non-deny default effects, and unsafe data', () => {
  assert.throws(
    () => assertDelegationPolicy(createPolicy({
      defaultEffect: 'allow',
    })),
    /defaultEffect/,
  );

  assert.throws(
    () => assertDelegationPolicy(createPolicy({
      rules: [
        createPolicy().rules[0],
        createPolicy().rules[0],
      ],
    })),
    /duplicated ruleId/,
  );

  assert.throws(
    () => assertDelegationPolicy(createPolicy({
      rules: [
        {
          ...createPolicy().rules[0],
          apiKey: buildFakeOpenRouterSecretProbe('secretvalue1234567890'),
        },
      ],
    })),
    /secret-like/u,
  );

  assert.throws(
    () => assertDelegationPolicy(createPolicy({
      rules: [
        {
          ...createPolicy().rules[0],
          agentIds: ['evaluation-audit-steward'],
        },
      ],
    })),
    /must not include agentId or agentIds/u,
  );
});

test('evaluateDelegationPolicy allows Alfred to delegate ask work to Bruce', () => {
  const result = evaluateDelegationPolicy({
    actionRequest: createDelegateRequest(),
    delegationPolicy: createPolicy(),
  });

  assert.equal(result.authorized, true);
  assert.equal(result.effect, 'allow');
  assert.equal(result.reasonCode, 'allowed_by_delegation_policy_rule');
  assert.equal(result.matchedRule.ruleId, 'allow-alfred-to-bruce-probabilistic-ask');
  assert.equal(result.matchedRule.fromOperationalIdentityId, 'alfred');
  assert.equal(result.matchedRule.toOperationalIdentityId, 'bruce');
});

test('evaluateDelegationPolicy denies unknown delegation with an explainable reason', () => {
  const result = evaluateDelegationPolicy({
    actionRequest: createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'maria',
        task: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    }),
    delegationPolicy: createPolicy(),
  });

  assert.equal(result.authorized, false);
  assert.equal(result.effect, 'deny');
  assert.equal(result.reasonCode, 'no_matching_delegation_policy_rule');
  assert.match(result.reason, /No delegation policy rule allows alfred to delegate delegate to maria/u);
});

test('readDelegationPolicy loads authored policy config and returns null when missing', async () => {
  const projectRootPath = await createProjectFixture();

  const loaded = await readDelegationPolicy({ projectRootPath });

  assert.equal(loaded.delegationPolicyPath, path.join(projectRootPath, DEFAULT_DELEGATION_POLICY_ROOT_PATH));
  assert.equal(loaded.delegationPolicy.rules[0].ruleId, 'allow-alfred-to-bruce-probabilistic-ask');

  const missingRootPath = await createProjectFixture({ includePolicy: false });
  const missing = await readDelegationPolicy({ projectRootPath: missingRootPath });

  assert.equal(missing.delegationPolicy, null);
});

test('checked-in OpenMAS delegation policy explicitly allows Alfred to Bruce', async () => {
  const { delegationPolicy } = await readDelegationPolicy({
    projectRootPath: process.cwd(),
  });

  assert.ok(delegationPolicy);
  const result = evaluateDelegationPolicy({
    actionRequest: createDelegateRequest(),
    delegationPolicy,
  });

  assert.equal(result.authorized, true);
  assert.equal(result.matchedRule.ruleId, 'allow-alfred-to-bruce-probabilistic-ask');
});

test('getDelegationPolicyAllowedRequesters derives OS Action Gate requesters from policy rules', () => {
  const allowedRequesters = getDelegationPolicyAllowedRequesters(createPolicy());

  assert.deepEqual(allowedRequesters, [
    {
      type: 'operational_identity',
      id: 'alfred',
    },
  ]);
});

test('evaluateOsActionRequest can enforce authored delegation policy without ad hoc requester arrays', () => {
  const accepted = evaluateOsActionRequest({
    request: createDelegateRequest(),
    runtimeRequester: {
      type: 'operational_identity',
      id: 'alfred',
    },
    delegationPolicy: createPolicy(),
    now: () => NOW,
  });

  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.actionResult.payload.delegationPolicyRuleId, 'allow-alfred-to-bruce-probabilistic-ask');

  const denied = evaluateOsActionRequest({
    request: createDelegateRequest({
      payload: {
        targetOperationalIdentityId: 'maria',
        task: 'Inspect the MAS and report findings.',
        command: 'ask',
        mode: 'probabilistic',
      },
    }),
    runtimeRequester: {
      type: 'operational_identity',
      id: 'alfred',
    },
    delegationPolicy: createPolicy(),
    now: () => NOW,
  });

  assert.equal(denied.status, 'rejected');
  assert.equal(denied.actionResult.payload.reasonCode, 'no_matching_delegation_policy_rule');
  assert.equal(denied.actionResult.payload.policyEffect, 'deny');
});
