import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const string = { type: 'string', minLength: 1, maxLength: 8000 };
const id = { type: 'string', pattern: '^[a-f0-9-]{36}$' };
const define = (name, description, properties, required = []) => ({ name, description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } });

export const JOB_TOOLS = [
  define('atlas_start_paper', 'Start or recover one paper job from a DOI, URL or source path. Returns shared role invocations; do not author a role prompt or paper JSON. Same input and options recover the existing job; fresh=true starts a new investigation. Work is stored as structured article data. publish=true requests reader delivery with atlas_publish_article; starting or finishing a task does not publish it.', {
    input: string, request: string, publish: { type: 'boolean' }, replace: { type: 'boolean' }, fresh: { type: 'boolean' }
  }, ['input']),
  define('atlas_agent_task', 'Read the current job or a task capsule by ID. Returns input, scope, draft ID and concrete revision findings, never the full paper or previous agent reasoning. Use job_id after interruption; resume=true reopens a blocked assignment when its blocker can now be addressed.', { task_id: id, job_id: id, resume: { type: 'boolean' } }),
  define('atlas_finish_task', 'Save a task outcome, findings and optional article_id. Does not require review stamps, create another task or publish. Use atlas_publish_article explicitly for reader delivery.', {
    task_id: id, article_id: id, outcome: { enum: ['ready', 'revise', 'blocked'] },
    findings: { type: 'array', items: string, maxItems: 50 }
  }, ['task_id', 'outcome'])
];

const validId = value => {
  if (!/^[a-f0-9-]{36}$/.test(value || '')) throw new Error('Use the ID returned by the paper job tools.');
  return value;
};

export function createPaperJobs({ workspace, articleWorkflow }) {
  const load = async jobId => JSON.parse(await workspace.readText(`jobs/${validId(jobId)}/state.json`, { maxBytes: 20_000_000 }));
  const save = async job => {
    const base = `jobs/${job.id}`, temporary = `${base}/${randomUUID()}.tmp`;
    await workspace.writeBuffer(temporary, Buffer.from(JSON.stringify(job)));
    await rename(await workspace.pathFor(temporary), await workspace.pathFor(`${base}/state.json`));
  };
  const locked = async (lockPath, operation) => {
    const lock = await workspace.pathFor(lockPath);
    try { await mkdir(lock); } catch (error) {
      if (error.code === 'EEXIST') throw new Error('This job is being updated; retry the same call after it finishes.');
      throw error;
    }
    try { return await operation(); } finally { await rm(lock, { recursive: true, force: true }); }
  };
  const current = job => job.tasks.at(-1);
  const envelope = job => {
    const task = current(job);
    const message = `Read atlas_read_contract name=${task.role}, then atlas_agent_task task_id=${task.id}. Carry out that saved role and task. Return the atlas_finish_task result.`;
    return { job_id: job.id, status: job.status, ...(job.result ? { result: job.result } : {}),
      ...(job.status !== 'completed' ? { task_id: task.id, role: task.role,
        codex_agent_type: task.role === 'paper-worker' ? 'evidence-atlas-writer' : 'evidence-atlas-reviewer',
        role_prompt_path: fileURLToPath(new URL(`./prompts/${task.role}.txt`, import.meta.url)),
        codex_invocation: { agent_type: 'default', task_name: `${task.role.replaceAll('-', '_')}_${task.id.slice(0, 8)}`, fork_turns: 'none', message },
        invocation: { subagent_type: task.role, description: task.role === 'paper-worker' ? 'Read and investigate paper' : 'Review paper evidence',
          prompt: `Read atlas_agent_task with task_id=${task.id} and carry out your configured role. Return the atlas_finish_task result.` } } : {}) };
  };
  const addTask = (job, role, findings = []) => {
    job.tasks.push({ id: randomUUID(), role, findings, status: 'pending' });
    job.status = role === 'paper-worker' ? 'working' : 'reviewing';
  };
  const locate = async taskId => {
    validId(taskId);
    const listing = await workspace.list('jobs', { limit: 500 });
    for (const entry of listing.entries.filter(e => e.type === 'directory' && /^[a-f0-9-]{36}$/.test(e.path))) {
      const job = await load(entry.path);
      if (job.tasks.some(t => t.id === taskId)) return job;
    }
    throw new Error('Unknown task_id. Use atlas_agent_task with the saved job_id.');
  };
  return {
    atlas_start_paper: async args => {
      await workspace.ensureDirectory('jobs');
      return locked('jobs/.start-lock', async () => {
        const spec = { input: args.input.trim(), request: args.request?.trim() || '', publish: Boolean(args.publish), replace: Boolean(args.replace) };
        const listing = await workspace.list('jobs', { limit: 500 });
        for (const entry of listing.entries.filter(e => e.type === 'directory' && /^[a-f0-9-]{36}$/.test(e.path))) {
          const existing = await load(entry.path);
          if (!args.fresh && JSON.stringify(existing.spec) === JSON.stringify(spec)) return envelope(existing);
        }
        const job = { id: randomUUID(), spec, created: new Date().toISOString(), tasks: [] };
        addTask(job, 'paper-worker');
        await save(job);
        return envelope(job);
      });
    },
    atlas_agent_task: async args => {
      if (Boolean(args.task_id) === Boolean(args.job_id)) throw new Error('Provide exactly one of task_id or job_id.');
      let job = args.job_id ? await load(args.job_id) : await locate(args.task_id);
      if (args.resume) job = await locked(`jobs/${job.id}/.lock`, async () => {
        const latest = await load(job.id);
        if (latest.status === 'blocked') {
          current(latest).status = 'pending';
          latest.status = current(latest).role === 'paper-worker' ? 'working' : 'reviewing';
          await save(latest);
        }
        return latest;
      });
      const task = args.task_id ? job.tasks.find(t => t.id === args.task_id) : current(job);
      return { ...envelope(job), requested_task_status: task.status,
        input: job.spec.input, request: job.spec.request, article_id: job.article_id,
        findings: task.findings, delivery: job.spec.publish ? 'saved structured article and reader publication' : 'saved structured article',
        current_task: task.id === current(job).id,
        next: job.status === 'completed' ? 'Use result; this job is complete.' : 'Use article tools and literature tools for the work. Save progress with atlas_finish_task. Use atlas_publish_article when reader delivery is requested.' };
    },
    atlas_finish_task: async args => {
      const found = await locate(args.task_id);
      return locked(`jobs/${found.id}/.lock`, async () => {
        const job = await load(found.id), task = job.tasks.find(t => t.id === args.task_id);
        if (args.article_id) job.article_id = args.article_id;
        task.status = args.outcome === 'ready' ? 'completed' : args.outcome;
        task.findings = args.findings || [];
        job.status = args.outcome === 'ready' ? 'completed' : args.outcome === 'blocked' ? 'blocked' : 'working';
        delete job.review_snapshot;
        if (args.outcome === 'ready' && job.article_id) {
          job.result = { article_id: job.article_id, article_path: `articles/${job.article_id}/state.json`, saved: true };
        }
        await save(job);
        return envelope(job);
      });
    }
  };
}
