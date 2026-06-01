import { randomBytes } from 'node:crypto';

export function generateMasterKey() {
  return randomBytes(32).toString('hex');
}
