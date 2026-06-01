import { writeFile } from 'node:fs/promises';

export async function writeJsonFile(filePath, data) {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(filePath, content, 'utf8');
  return filePath;
}
