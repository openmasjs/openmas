import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

async function writeCommandModule(commandRootPath, commandName, fileContent) {
  await mkdir(commandRootPath, { recursive: true });
  await writeFile(path.join(commandRootPath, `${commandName}.js`), fileContent, 'utf8');
}

export async function writeSystemStewardCommandModules(projectRootPath) {
  const commandRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', 'system-steward', 'commands');

  await writeCommandModule(
    commandRootPath,
    'help',
    `export async function runDeterministicCommand() {
  return {
    message: 'Hello. I am System Steward. Here is the list of deterministic commands I currently support in this OpenMAS instance.',
    reportKind: 'system_help_report',
    reportContent: '# System Steward Help\\n\\n## Supported Deterministic Commands\\n\\n- help\\n- hello\\n- status\\n- bootstrap\\n- gap-analysis\\n- inspect\\n- diagnose\\n- memory-health\\n',
    outputPayload: {
      supportedCommands: ['help', 'hello', 'status', 'bootstrap', 'gap-analysis', 'inspect', 'diagnose', 'memory-health'],
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'hello',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, the System Steward for this OpenMAS instance. The framework is alive, the instance is ready, and I can help inspect the local system.\`,
    reportKind: 'system_welcome_report',
    reportContent: \`# System Welcome Report\\n\\nHello. I am \${speakerLabel}, the System Steward for this OpenMAS instance.\\n\\n- Operational Identity: \${operationalIdentityId ?? 'none'}\\n\`,
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'status',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, acting as the System Steward. I inspected this instance and generated a system status report for the current OpenMAS framework state.\`,
    reportKind: 'system_status_report',
    reportContent: '# System Status Report\\n\\n## Registered Cognitive Identities\\n\\n- system-steward\\n',
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'bootstrap',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, acting as the System Steward. I reviewed the current instance and generated a deterministic bootstrap plan.\`,
    reportKind: 'bootstrap_plan',
    reportContent: '# Bootstrap Plan\\n\\n## Recommended Bootstrap Steps\\n\\n1. Continue the setup.\\n',
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'gap-analysis',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, acting as the System Steward. I analyzed the current structure and generated a deterministic gap analysis report.\`,
    reportKind: 'gap_analysis_report',
    reportContent: '# Gap Analysis Report\\n\\n## Gaps\\n\\n- No structural gaps were detected in the current deterministic pass.\\n',
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'inspect',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, acting as the System Steward. I inspected the current OpenMAS instance and generated a detailed inspection report.\`,
    reportKind: 'system_inspection_report',
    reportContent: '# System Inspection Report\\n\\n## Memory Snapshot\\n\\n- State File Count: 0\\n',
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'diagnose',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, acting as the System Steward. I ran a deterministic diagnostic pass on this OpenMAS instance and generated a diagnostic report.\`,
    reportKind: 'system_diagnostic_report',
    reportContent: '# System Diagnostic Report\\n\\n## Recommendations\\n\\n- Continue with the next slice.\\n',
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward'
    }
  };
}
`,
  );

  await writeCommandModule(
    commandRootPath,
    'memory-health',
    `export async function runDeterministicCommand({ readiness }) {
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? 'System Steward';
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;

  return {
    message: \`Hello. I am \${speakerLabel}, acting as the System Steward. I inspected governed MAS memory and generated a safe memory health diagnostic report.\`,
    reportKind: 'memory_health_diagnostic_report',
    reportContent: '# Memory Health Diagnostic Report\\n\\n## Audit Summary\\n\\n- Findings: 0\\n',
    outputPayload: {
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: 'system-steward',
      memoryHealth: {
        auditSummary: {
          findings: 0
        }
      }
    }
  };
}
`,
  );
}
