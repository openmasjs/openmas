#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HABITAT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_OPENMAS_CLI = path.join(HABITAT_ROOT, 'bin', 'openmas.js');

const DEFAULT_CHILD_TASK = 'Bruce, in one short sentence, confirm that you received the OpenMAS delegation try-me request.';

function resolveChildTask() {
  const childTask = process.argv.slice(2).join(' ').trim();

  if (childTask.length > 0) {
    return childTask;
  }

  return DEFAULT_CHILD_TASK;
}

function runOpenMasAsk(prompt) {
  return spawnSync(
    process.execPath,
    [
      LOCAL_OPENMAS_CLI,
      'ask',
      'alfred',
      prompt,
    ],
    {
      cwd: HABITAT_ROOT,
      env: process.env,
      stdio: 'inherit',
    },
  );
}

const childTask = resolveChildTask();
const requestedEnvelopeShape = JSON.stringify({
  kind: 'brain_tool_request',
  version: 1,
  toolRequestId: 'tool-request-alpha-delegation-try-me',
  toolId: 'mas.os.delegate',
  input: {
    targetOperationalIdentityId: 'bruce',
    task: childTask,
    command: 'ask',
    mode: 'probabilistic',
    parentContext: {
      jobId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
      processId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
      threadId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
    },
  },
  purpose: 'OpenMAS delegation try-me',
  expectedSideEffectLevel: 'write_internal',
}, null, 2);
const prompt = [
  'Return exactly one JSON object and no prose.',
  'The returned JSON must match this object shape:',
  requestedEnvelopeShape,
  'Replace input.parentContext with the exact parentContext object from the OpenMAS OS Runtime Context layer.',
  'input must be a JSON object, not a string.',
  'input.parentContext must be a JSON object, not a string.',
  'Do not escape, quote, stringify, or nest the input object as text.',
  'Emit kind "brain_tool_request", version 1, toolRequestId "tool-request-alpha-delegation-try-me", toolId "mas.os.delegate", purpose "OpenMAS delegation try-me", and expectedSideEffectLevel "write_internal".',
  'Copy the current OpenMAS OS parentContext object exactly as provided by your OpenMAS OS context layer into input.parentContext.',
  'Set input.targetOperationalIdentityId to "bruce".',
  `Set input.task exactly to ${JSON.stringify(childTask)}.`,
  'Set input.command to "ask".',
  'Set input.mode to "probabilistic".',
  'Do not use mas.os.schedule_delegation for this request.',
].join('\n');

const result = runOpenMasAsk(prompt);

if (typeof result.status === 'number') {
  process.exitCode = result.status;
} else {
  console.error(`OpenMAS delegation try-me failed to launch: ${result.error?.message ?? 'unknown error'}`);
  process.exitCode = 1;
}
