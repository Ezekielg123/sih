import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/agents/runner.js';
import { db } from '../src/db/store.js';
import { executeTool } from '../src/agents/tools/index.js';
import { findRelated } from '../src/services/matching.js';
import { getOllamaConfig, ollamaStatus } from '../src/agents/ollama.js';

const admin = { id: 'test-agent-admin', role: 'admin', bureau: null };
const complaint = () => db.complaints.find((c) => findRelated(c, db.complaints).length > 0) || db.complaints[0];
const response = (message) => ({ message });
const finalMessage = (c) => response({ role: 'assistant', content: `Recommendation follows:\n\`\`\`json\n${JSON.stringify({
  summary: 'Review the evidence and coordinate with the assigned bureau.',
  classification: c.category,
  suggestedBureau: c.bureau,
  missingInformation: ['Confirm the supporting records are complete.'],
  recommendedActions: ['Review the cited case evidence with the assigned bureau.'],
  confidence: 'medium', confidenceNote: 'Category and bureau values are valid, qualitative assessment.',
})}\n\`\`\`` });
const call = (name, args) => ({ function: { name, arguments: args } });

test('Ollama config reads environment and status does not expose its base URL', async () => {
  const config = getOllamaConfig({ OLLAMA_BASE_URL: 'http://localhost:11434', OLLAMA_MODEL: 'llama3.2:latest', AGENT_MAX_TOOL_CALLS: '9' });
  assert.equal(config.baseUrl, 'http://localhost:11434');
  assert.equal(config.model, 'llama3.2:latest');
  assert.equal(config.maxToolCalls, 6);
  const status = await ollamaStatus({ list: async () => ({ models: [{ name: 'llama3.2:latest' }] }) }, config);
  assert.equal(status.available, true);
  assert.equal(status.baseUrl, undefined);
});

test('Ollama requests and executes actual scoped backend tools, then returns validated output', async () => {
  const c = complaint();
  const requested = ['classifyComplaint','searchRelatedComplaints','checkSlaStatus','recommendNextAction'];
  let turn = 0, schemaRequested = false;
  const client = { chat: async (request) => { schemaRequested ||= request.format?.type === 'object' && request.format?.additionalProperties === false; return turn++ === 0
    ? response({ role: 'assistant', content: '', tool_calls: requested.map((name) => call(name, { complaintId: c.id })) })
    : finalMessage(c); } };
  const run = await analyze(c.id, admin, { ollamaClient: client, config: { model: 'llama3.2:latest', maxToolCalls: 6, maxIterations: 3, timeoutMs: 200 } });
  assert.equal(run.provider, 'ollama');
  assert.equal(schemaRequested, true);
  assert.equal(run.fallbackUsed, false);
  assert.equal(run.recommendation.classification, c.category);
  assert.ok(Array.isArray(run.recommendation.evidence.matches));
  assert.equal(run.recommendation.confidence.level, 'medium');
  assert.equal(run.recommendation.fallbackUsed, false);
  assert.ok(run.timeline.some((step) => step.tool === 'searchRelatedComplaints' && step.status === 'complete'));
  assert.ok(run.recommendation.toolExecutions.every((step) => step.result || step.error));
  assert.equal(run.results.checkSlaStatus.policyLabel.includes('not official'), true);
});

test('Ollama tool execution is bounded by configured per-run maximum', async () => {
  const c = complaint();
  const client = { chat: async () => response({ role: 'assistant', content: '', tool_calls: [
    call('classifyComplaint', { complaintId: c.id }), call('searchRelatedComplaints', { complaintId: c.id }),
    call('checkSlaStatus', { complaintId: c.id }),
  ] }) };
  const run = await analyze(c.id, admin, { ollamaClient: client, config: { model: 'mock', maxToolCalls: 2, maxIterations: 2, timeoutMs: 200 } });
  assert.equal(run.timeline.length, 2);
  assert.equal(run.timeline[0].tool, 'getComplaintDetails');
  assert.equal(run.timeline[1].tool, 'classifyComplaint');
});

test('unknown tools and malformed tool inputs are rejected and recorded', async () => {
  const c = complaint(); let turn = 0;
  const client = { chat: async () => turn++ === 0 ? response({ role: 'assistant', content: '', tool_calls: [
    call('runShell', { command: 'nope' }), call('checkSlaStatus', { complaintId: -1 }),
  ] }) : finalMessage(c) };
  const run = await analyze(c.id, admin, { ollamaClient: client, config: { model: 'mock', maxToolCalls: 6, maxIterations: 3, timeoutMs: 200 } });
  assert.equal(run.timeline.find((s) => s.tool === 'unknownTool').status, 'rejected');
  assert.equal(run.timeline.find((s) => s.tool === 'checkSlaStatus').status, 'rejected');
});

test('model cannot request a tool against a different complaint ID', async () => {
  const c = complaint();
  const other = db.complaints.find((item) => item.id !== c.id);
  let turn = 0;
  const client = { chat: async () => turn++ === 0 ? response({ role: 'assistant', content: '', tool_calls: [call('checkSlaStatus', { complaintId: other.id })] }) : finalMessage(c) };
  const run = await analyze(c.id, admin, { ollamaClient: client, config: { model: 'mock', maxToolCalls: 6, maxIterations: 3, timeoutMs: 200 } });
  const rejected = run.timeline.find((step) => step.tool === 'checkSlaStatus' && step.status === 'rejected');
  assert.match(rejected.error, /match the complaint selected/i);
});

test('Ollama unavailable and timed out requests use deterministic tool workflow', async () => {
  const c = complaint();
  const unavailable = await analyze(c.id, admin, { ollamaClient: { chat: async () => { throw new Error('connection refused'); } }, config: { model: 'mock', maxToolCalls: 6, maxIterations: 2, timeoutMs: 200 } });
  assert.equal(unavailable.fallbackUsed, true);
  assert.match(unavailable.fallbackReason, /connection refused/);
  assert.ok(unavailable.timeline.some((s) => s.tool === 'checkSlaStatus' && s.status === 'complete'));
  const timedOut = await analyze(c.id, admin, { ollamaClient: { chat: () => new Promise(() => {}) }, config: { model: 'mock', maxToolCalls: 6, maxIterations: 2, timeoutMs: 15 } });
  assert.equal(timedOut.fallbackUsed, true);
  assert.match(timedOut.fallbackReason, /timed out/);
});

test('unauthorized callers cannot run agent or protected tools', async () => {
  await assert.rejects(() => analyze(complaint().id, { id: 'viewer', role: 'viewer' }, { ollamaClient: { chat: async () => assert.fail('must not call Ollama') } }), /authorization required/i);
  await assert.rejects(() => executeTool('checkSlaStatus', { complaintId: complaint().id }, { id: 'viewer', role: 'viewer' }), /authorization required/i);
  await assert.rejects(() => executeTool('checkSlaStatus', { complaintId: complaint().id }, { id: 'limited-officer', role: 'officer', bureau: 'Unassigned Bureau' }), /bureau scope/i);
  await assert.rejects(() => executeTool('approveEscalationProposal', { complaintId: complaint().id }, admin), /not allowed/i);
});

test('model can prepare a proposal but cannot approve it or link cases', async () => {
  const c = complaint();
  await assert.rejects(() => executeTool('linkRelatedCases', { complaintId: c.id, relatedComplaintId: db.complaints.find((x) => x.id !== c.id)?.id }, admin), /human approval/i);
  assert.equal(db.related.some((x) => x.complaintId === c.id && x.status === 'confirmed' && x.approvedBy === admin.id), false);
  const existing = db.proposals.find((p) => p.complaintId === c.id && p.status === 'pending');
  if (existing) assert.notEqual(existing.status, 'approved');
});

test('related matches preserve actual backend evidence and remain suggestions', async () => {
  const c = complaint();
  const run = await analyze(c.id, admin, { ollamaClient: { chat: async () => { throw new Error('offline'); } }, config: { model: 'mock', maxToolCalls: 6, maxIterations: 2, timeoutMs: 100 } });
  const expected = findRelated(c, db.complaints);
  assert.deepEqual(run.recommendation.matches.map((m) => m.referenceId), expected.slice(0, 5).map((m) => m.referenceId));
  assert.ok(run.recommendation.matches.every((m) => Array.isArray(m.reasons) && m.confirmedDuplicate === false));
});
