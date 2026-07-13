/**
 * ============================================================================
 * 1. LOCAL LLM INITIALISATION
 * ============================================================================
 *
 * ChatOllama speaks to a locally running Ollama daemon over plain HTTP — no
 * cloud, no key, no cost. We pin temperature to 0 so a classroom demo produces
 * the *same* answer every run: reproducibility beats creativity when teaching.
 *
 * `llama3.2` is chosen because it supports native tool-calling in Ollama, which
 * is what makes the agentic loop in `graph/` possible. Swap the string for
 * "mistral" (also tool-capable) if that model is the one you have pulled.
 */

import { ChatOllama } from "@langchain/ollama";

export const llm = new ChatOllama({
  baseUrl: "http://localhost:11434", // the standard local Ollama endpoint
  model: "llama3.2",                 // must be pulled first: `ollama pull llama3.2`
  temperature: 0,                    // deterministic output for demos
});
