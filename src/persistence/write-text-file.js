import { writeFile } from 'node:fs/promises';

export async function writeTextFile(filePath, content) {
  await writeFile(filePath, `${content}\n`, 'utf8');
  return filePath;
}
