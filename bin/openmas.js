#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log('OpenMAS CLI');
  console.log('');
  console.log('Usage:');
  console.log('  openmas --help');
  console.log('  openmas invoke --agent <id> --mode <mode> --command <command> [options]');
  console.log('  openmas invoke <agent> <command> [invoke options]');
  console.log('  openmas ask <agent> <input> [invoke options]');
  console.log('  openmas credentials edit <environment>');
  console.log('  openmas credentials show <environment>');
  console.log('  openmas os status');
  console.log('  openmas os watch --interval 1000');
  console.log('  openmas doctor');
  console.log('');
  console.log('Commands:');
  console.log('  invoke        Invoke an Operational Identity through the Agent runtime');
  console.log('  ask           Friendly shortcut for a probabilistic ask invocation');
  console.log('  credentials   Manage the OpenMAS Credential Vault');
  console.log('  os            Inspect or run the local OpenMAS OS service');
  console.log('  doctor        Diagnose local OpenMAS habitat readiness');
  console.log('');
  console.log('Examples:');
  console.log('  openmas invoke --agent alfred --mode deterministic --command hello');
  console.log('  openmas invoke alfred hello');
  console.log('  openmas ask alfred "Please inspect this habitat."');
  console.log('  openmas credentials edit development');
  console.log('  openmas os status');
  console.log('  openmas doctor');
}

function runNodeScript(scriptName, args) {
  const scriptPath = path.join(BIN_DIR, scriptName);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });

  if (typeof result.status === 'number') {
    process.exitCode = result.status;
    return;
  }

  if (result.error) {
    console.error(`OpenMAS CLI failed to launch ${scriptName}: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = 1;
}

function runAskCommand(args) {
  const [agent, input, ...rest] = args;

  if (!agent || !input) {
    console.error('OpenMAS CLI');
    console.error('Status: failed');
    console.error('Error: openmas ask requires an agent and input text.');
    console.error('');
    console.error('Usage: openmas ask <agent> <input> [invoke options]');
    process.exitCode = 1;
    return;
  }

  runNodeScript('invoke-agent.js', [
    '--agent',
    agent,
    '--mode',
    'probabilistic',
    '--command',
    'ask',
    '--input',
    input,
    ...rest,
  ]);
}

function printInvokeHelp() {
  console.log('OpenMAS Invoke');
  console.log('');
  console.log('Usage:');
  console.log('  openmas invoke --agent <id> --mode <mode> --command <command> [options]');
  console.log('  openmas invoke <agent> <command> [invoke options]');
  console.log('');
  console.log('Examples:');
  console.log('  openmas invoke --agent alfred --mode deterministic --command hello');
  console.log('  openmas invoke alfred hello');
  console.log('  openmas ask alfred "Can you inspect the habitat?"');
}

function hasInvocationModeOption(args) {
  return args.some((argument) => {
    return argument === '--mode'
      || argument === '--invocation-mode'
      || argument.startsWith('--mode=')
      || argument.startsWith('--invocation-mode=');
  });
}

function normalizeInvokeCommandArgs(args) {
  const [firstArgument, secondArgument, ...rest] = args;

  if (!firstArgument || firstArgument.startsWith('-')) {
    return args;
  }

  if (!secondArgument || secondArgument.startsWith('-')) {
    throw new Error('openmas invoke shortcut requires an agent and command.');
  }

  const normalizedArgs = [
    '--agent',
    firstArgument,
  ];

  if (!hasInvocationModeOption(rest)) {
    normalizedArgs.push('--mode', 'deterministic');
  }

  normalizedArgs.push('--command', secondArgument, ...rest);

  return normalizedArgs;
}

function runInvokeCommand(args) {
  const [firstArgument] = args;

  if (!firstArgument || firstArgument === '--help' || firstArgument === '-h' || firstArgument === 'help') {
    printInvokeHelp();
    return;
  }

  try {
    runNodeScript('invoke-agent.js', normalizeInvokeCommandArgs(args));
  } catch (error) {
    console.error('OpenMAS Invoke');
    console.error('Status: failed');
    console.error(`Error: ${error.message}`);
    console.error('');
    printInvokeHelp();
    process.exitCode = 1;
  }
}

function printOsHelp() {
  console.log('OpenMAS OS');
  console.log('');
  console.log('Usage:');
  console.log('  openmas os status [options]');
  console.log('  openmas os watch [options]');
  console.log('  openmas os tick [options]');
  console.log('  openmas os submit-system-call <path> [options]');
  console.log('');
  console.log('Examples:');
  console.log('  openmas os status');
  console.log('  openmas os watch --interval 1000');
  console.log('  openmas os tick --max-dispatched-jobs 1');
}

function runOsCommand(args) {
  const [osCommand, ...rest] = args;

  if (!osCommand || osCommand === '--help' || osCommand === '-h' || osCommand === 'help') {
    printOsHelp();
    return;
  }

  if (osCommand === 'status') {
    runNodeScript('openmas-os-service.js', ['--status', ...rest]);
    return;
  }

  if (osCommand === 'watch') {
    runNodeScript('openmas-os-service.js', ['--watch', ...rest]);
    return;
  }

  if (osCommand === 'tick') {
    runNodeScript('openmas-os-service.js', ['--tick', ...rest]);
    return;
  }

  if (osCommand === 'submit-system-call') {
    const [systemCallPath, ...submitRest] = rest;

    if (!systemCallPath) {
      console.error('OpenMAS OS');
      console.error('Status: failed');
      console.error('Error: openmas os submit-system-call requires a System Call JSON path.');
      process.exitCode = 1;
      return;
    }

    runNodeScript('openmas-os-service.js', ['--submit-system-call', systemCallPath, ...submitRest]);
    return;
  }

  if (osCommand.startsWith('--')) {
    runNodeScript('openmas-os-service.js', args);
    return;
  }

  console.error('OpenMAS OS');
  console.error('Status: failed');
  console.error(`Error: Unsupported OS command "${osCommand}".`);
  console.error('');
  printOsHelp();
  process.exitCode = 1;
}

function main(argv) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'invoke':
      runInvokeCommand(args);
      return;

    case 'ask':
      runAskCommand(args);
      return;

    case 'credentials':
      runNodeScript('credentials.js', args);
      return;

    case 'os':
      runOsCommand(args);
      return;

    case 'doctor':
      runNodeScript('openmas-doctor.js', args);
      return;

    default:
      console.error('OpenMAS CLI');
      console.error('Status: failed');
      console.error(`Error: Unsupported command "${command}".`);
      console.error('');
      printHelp();
      process.exitCode = 1;
  }
}

main(process.argv.slice(2));
