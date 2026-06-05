#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HABITAT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_OPENMAS_CLI = path.join(HABITAT_ROOT, 'bin', 'openmas.js');
const DEFAULT_DELAY_SECONDS = 90;
const MINIMUM_DELAY_SECONDS = 30;
const MAXIMUM_DELAY_SECONDS = 30 * 60;
const DEFAULT_CHILD_TASK = 'Bruce, in one short sentence, confirm that you received the OpenMAS scheduled delegation try-me request.';

function parseScriptArguments(argv) {
  const taskParts = [];
  let delaySeconds = process.env.OPENMAS_TRY_SCHEDULE_DELAY_SECONDS;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--delay-seconds') {
      delaySeconds = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (argument.startsWith('--delay-seconds=')) {
      delaySeconds = argument.slice('--delay-seconds='.length);
      continue;
    }

    taskParts.push(argument);
  }

  return {
    delaySeconds,
    childTask: taskParts.join(' ').trim(),
  };
}

function resolveDelaySeconds(value) {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return DEFAULT_DELAY_SECONDS;
  }

  const delaySeconds = Number.parseInt(String(value), 10);

  if (
    !Number.isInteger(delaySeconds)
    || delaySeconds < MINIMUM_DELAY_SECONDS
    || delaySeconds > MAXIMUM_DELAY_SECONDS
  ) {
    throw new Error('OPENMAS_TRY_SCHEDULE_DELAY_SECONDS must be an integer between 30 and 1800.');
  }

  return delaySeconds;
}

function resolveChildTask(childTask) {
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

const parsedArguments = parseScriptArguments(process.argv.slice(2));
let delaySeconds;

try {
  delaySeconds = resolveDelaySeconds(parsedArguments.delaySeconds);
} catch (error) {
  console.error('OpenMAS scheduled delegation try-me failed');
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

const childTask = resolveChildTask(parsedArguments.childTask);
const requestedRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
const requestedEnvelopeShape = JSON.stringify({
  kind: 'brain_tool_request',
  version: 1,
  toolRequestId: 'tool-request-alpha-scheduled-try-me',
  toolId: 'mas.os.schedule_delegation',
  input: {
    targetOperationalIdentityId: 'bruce',
    task: childTask,
    runAt: requestedRunAt,
    missedRunPolicy: 'delay',
    command: 'ask',
    mode: 'probabilistic',
    parentContext: {
      jobId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
      processId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
      threadId: 'COPY_FROM_OPENMAS_OS_RUNTIME_CONTEXT',
    },
  },
  purpose: 'OpenMAS scheduled delegation try-me',
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
  'Emit kind "brain_tool_request", version 1, toolRequestId "tool-request-alpha-scheduled-try-me", toolId "mas.os.schedule_delegation", purpose "OpenMAS scheduled delegation try-me", and expectedSideEffectLevel "write_internal".',
  'Copy the current OpenMAS OS parentContext object exactly as provided by your OpenMAS OS context layer into input.parentContext.',
  'Set input.targetOperationalIdentityId to "bruce".',
  `Set input.task exactly to ${JSON.stringify(childTask)}.`,
  `Set input.runAt exactly to ${JSON.stringify(requestedRunAt)} with no suffix and no transformation.`,
  'Set input.missedRunPolicy to "delay".',
  'Set input.command to "ask".',
  'Set input.mode to "probabilistic".',
].join('\n');

console.log('OpenMAS Scheduled Delegation Try Me');
console.log(`Requested Run At: ${requestedRunAt}`);
console.log(`Delay Seconds: ${delaySeconds}`);
console.log('');

const result = runOpenMasAsk(prompt);

if (typeof result.status === 'number') {
  process.exitCode = result.status;
} else {
  console.error(`OpenMAS scheduled delegation try-me failed to launch: ${result.error?.message ?? 'unknown error'}`);
  process.exitCode = 1;
}
