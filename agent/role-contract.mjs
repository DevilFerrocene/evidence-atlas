import { readFile } from 'node:fs/promises';

export async function readRoleContract(role) {
  if (!['paper-worker', 'evidence-reviewer'].includes(role)) throw new Error(`Unknown role: ${role}`);
  const [skill, instructions] = await Promise.all([
    readFile(new URL('../SKILL.md', import.meta.url), 'utf8'),
    readFile(new URL(`./prompts/${role}.txt`, import.meta.url), 'utf8')
  ]);
  const examples = role === 'paper-worker'
    ? await readFile(new URL('./prompts/explanation-examples.md', import.meta.url), 'utf8')
    : '';
  return [skill, instructions, examples].filter(Boolean).join('\n\n---\n\n');
}
