import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export async function writeSimpleHelloCommandModule({
  projectRootPath,
  relativeCognitiveIdentityPath,
  roleName,
  defaultSpeakerLabel,
  reportKind,
  messageText,
}) {
  const commandRootPath = path.join(projectRootPath, 'instance', 'cognitive-identities', relativeCognitiveIdentityPath, 'commands');

  await mkdir(commandRootPath, { recursive: true });
  await writeFile(
    path.join(commandRootPath, 'hello.js'),
    `export async function runDeterministicCommand({ bootResult, readiness, request }) {
  const operationalIdentityId = readiness.operationalIdentityDefinition?.operationalIdentityId ?? null;
  const speakerLabel = readiness.operationalIdentityDefinition?.displayName ?? '${defaultSpeakerLabel}';

  return {
    message: \`Hello. I am \${speakerLabel}, acting as ${roleName}. ${messageText}\`,
    reportKind: '${reportKind}',
    reportContent: [
      '# ${roleName} Welcome Report',
      '',
      \`Hello. I am \${speakerLabel}, acting as ${roleName} for this OpenMAS instance.\`,
      '',
      \`- Operational Identity: \${operationalIdentityId ?? 'none'}\`,
      \`- Boot Status: \${bootResult.status}\`,
      \`- MAS Root: \${bootResult.masRootPath}\`,
    ].join('\\n'),
    outputPayload: {
      command: request.command,
      bootStatus: bootResult.status,
      operationalIdentityId,
      speakerLabel,
      cognitiveIdentityId: '${path.basename(relativeCognitiveIdentityPath)}',
    },
  };
}
`,
    'utf8',
  );
}
