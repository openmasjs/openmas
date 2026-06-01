#!/usr/bin/env node

import process from 'node:process';
import { runSystemBoot } from '../src/boot/run-system-boot.js';

const EXIT_CODE_BY_STATUS = {
  ready: 0,
  degraded: 1,
  blocked: 2,
  failed: 3,
};

function parseCommandLineArguments(argv) {
  const options = {
    projectRootPath: undefined,
    masRootHint: 'instance',
    strict: false,
    requestedBy: 'cli',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--strict') {
      options.strict = true;
      continue;
    }

    if (argument.startsWith('--project-root=')) {
      options.projectRootPath = argument.slice('--project-root='.length);
      continue;
    }

    if (argument === '--project-root') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --project-root');
      }

      options.projectRootPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith('--mas-root=')) {
      options.masRootHint = argument.slice('--mas-root='.length);
      continue;
    }

    if (argument === '--mas-root') {
      if (!argv[index + 1]) {
        throw new Error('Missing value for --mas-root');
      }

      options.masRootHint = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  return options;
}

function printBootSummary(bootResult) {
  console.log('OpenMAS System Boot');
  console.log(`Status: ${bootResult.status}`);
  console.log(`Project Root: ${bootResult.projectRootPath}`);
  console.log(`MAS Root: ${bootResult.masRootPath}`);
  console.log(`Invocation Ready: ${bootResult.invocationReadiness.allowed ? 'yes' : 'no'}`);
  console.log(`Next Step: ${bootResult.nextStep}`);

  if (bootResult.persistence) {
    console.log(`Persistence Target: ${bootResult.persistence.targetType}`);
    console.log(`Boot Session Record: ${bootResult.persistence.bootSessionRecordPath}`);
    console.log(`Boot Context Summary: ${bootResult.persistence.bootContextSummaryPath}`);
    console.log(`Boot Report: ${bootResult.persistence.bootReportPath}`);
  }

  if (bootResult.warnings.length > 0) {
    console.log(`Warnings: ${bootResult.warnings.join(' | ')}`);
  }

  if (bootResult.errors.length > 0) {
    console.log(`Errors: ${bootResult.errors.join(' | ')}`);
  }
}

function printFailedBoot(error) {
  console.error('OpenMAS System Boot');
  console.error('Status: failed');
  console.error(`Error: ${error.message}`);
}

async function main() {
  try {
    const bootOptions = parseCommandLineArguments(process.argv.slice(2));
    const bootResult = await runSystemBoot(bootOptions);

    printBootSummary(bootResult);

    process.exitCode = EXIT_CODE_BY_STATUS[bootResult.status] ?? EXIT_CODE_BY_STATUS.failed;
  } catch (error) {
    printFailedBoot(error);
    process.exitCode = EXIT_CODE_BY_STATUS.failed;
  }
}

await main();
