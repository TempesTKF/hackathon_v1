// LLM 工厂:有 key 用真模型,没 key 自动落回 Mock(断网开发/demo 兜底)
// 配了备用通道时:主通道(限流/故障)失败自动降级备用,再失败才轮到 mock
import type { LLMClient } from './client';
import { FailoverClient } from './failover';
import { OpenAICompatClient } from './openaiClient';

// 浏览器走 Vite 注入的 import.meta.env;headless 测试(tsx)走 globalThis.__LLM_ENV__
const env: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env) ||
  ((globalThis as Record<string, unknown>).__LLM_ENV__ as Record<string, string>) ||
  {};

const baseUrl = env.VITE_LLM_BASE_URL || '/api/llm';
const apiKey = env.VITE_LLM_API_KEY || (baseUrl.startsWith('/api/') ? 'server-proxy' : undefined);
// 备用通道(可选):主通道失败时自动降级
const fbBaseUrl = env.VITE_LLM_FALLBACK_BASE_URL;
const fbApiKey = env.VITE_LLM_FALLBACK_API_KEY;
const fbModel = env.VITE_LLM_FALLBACK_MODEL || 'deepseek/deepseek-v4-pro';

export const llmEnabled = !!(baseUrl && apiKey);

function mkClient(base: string, key: string, model: string, temperature: number): LLMClient {
  return new OpenAICompatClient({
    baseUrl: base,
    apiKey: key,
    model,
    temperature,
    // deepseek/qwen 默认带思考模式,必须显式关闭否则每次响应前空转数秒;其他家不认这个参数,不能乱塞
    extraBody: /deepseek|qwen/i.test(model) ? { enable_thinking: false } : undefined,
  });
}

function make(model: string | undefined, fallbackModel: string, temperature: number): LLMClient | null {
  if (!llmEnabled) return null;
  const primary = mkClient(baseUrl!, apiKey!, model || fallbackModel, temperature);
  if (fbBaseUrl && fbApiKey) return new FailoverClient(primary, mkClient(fbBaseUrl, fbApiKey, fbModel, temperature));
  return primary;
}

const DEFAULT_MODEL = 'deepseek/deepseek-v4-pro';

// 四个 agent 各自可配不同模型(患者要快,评估要强,判定层可用便宜小模型)
export const patientLLM = make(env.VITE_MODEL_PATIENT, DEFAULT_MODEL, 0.7); // 0.85→0.7:降低廉价路由吐垃圾 token 的概率
export const interpreterLLM = make(env.VITE_MODEL_INTERPRETER, DEFAULT_MODEL, 0.1);
export const expertLLM = make(env.VITE_MODEL_EXPERT, DEFAULT_MODEL, 0.5);
export const evaluatorLLM = make(env.VITE_MODEL_EVALUATOR, DEFAULT_MODEL, 0.3);
export const caseGeneratorLLM = make(env.VITE_MODEL_CASE_GENERATOR, DEFAULT_MODEL, 0.55);


