import { mkdir } from 'node:fs/promises';

export async function ensureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
  return directoryPath;
}
