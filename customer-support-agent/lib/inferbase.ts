import OpenAI from 'openai'
import { config } from './config'

/**
 * The whole integration: the official OpenAI SDK pointed at Inferbase. Routing, guardrails,
 * fallbacks and spend caps are the API key's routing policy, configured in Inferbase, so nothing
 * about them is in this code. `model: "auto"` asks the policy to choose per request.
 */
export function inferbase(): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey(),
    baseURL: config.baseURL,
    defaultHeaders: { 'X-Inferbase-Source': config.source },
  })
}
