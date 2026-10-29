import { Ollama } from 'ollama';

export function getOllamaConfig(env = process.env) {
  const boundedNumber = (value, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.min(max, Math.floor(number)) : fallback;
  };
  return {
    baseUrl: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: env.OLLAMA_MODEL || 'llama3.2:latest',
    timeoutMs: Math.max(1000, boundedNumber(env.OLLAMA_TIMEOUT_MS, 20000, 120000)),
    maxToolCalls: boundedNumber(env.AGENT_MAX_TOOL_CALLS, 6, 6),
    maxIterations: boundedNumber(env.AGENT_MAX_ITERATIONS, 3, 5),
  };
}

export function createOllamaClient(config = getOllamaConfig()) {
  const fetchWithTimeout = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(config.timeoutMs) });
  return new Ollama({ host: config.baseUrl, fetch: fetchWithTimeout });
}

export async function ollamaStatus(client = createOllamaClient(), config = getOllamaConfig()) {
  try {
    const { models = [] } = await client.list();
    const available = models.some((model) => model.name === config.model || model.name?.split(':')[0] === config.model.split(':')[0] && config.model.includes(':latest'));
    return { provider: available ? 'ollama' : 'deterministic-rules', model: config.model, available, reason: available ? null : 'configured_model_not_installed' };
  } catch {
    return { provider: 'deterministic-rules', model: config.model, available: false, reason: 'ollama_unavailable' };
  }
}
