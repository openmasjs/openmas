#!/usr/bin/env node

import {
  printOpenMasOsServiceError,
  runOpenMasOsServiceCommand,
} from '../src/os/service/openmas-os-service-cli.js';

try {
  await runOpenMasOsServiceCommand({
    argv: process.argv.slice(2),
  });
} catch (error) {
  printOpenMasOsServiceError(error);
  process.exitCode = 1;
}
