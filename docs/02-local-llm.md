# Local LLM (Ollama)

**Code:** [`src/llm.ts`](../src/llm.ts)

## The idea

A Large Language Model (LLM) is normally something you reach over the network to use — you send a prompt to OpenAI, Anthropic, or another provider's API, pay per token, and get a completion back. That has real costs: it requires an API key, an internet connection, per-request billing, and it sends your data to a third party.

**Ollama** flips this: it runs an open-weight LLM (Llama, Mistral, Gemma, etc.) as a local daemon on your own machine. It downloads model weights once, then serves them over a small HTTP API on `localhost:11434` — no internet needed after the initial pull, no API key, no per-token cost, and nothing leaves your machine.

From the application's point of view, "local LLM" vs. "cloud LLM" is mostly a difference in *where the HTTP request goes*, not in how you use it. That's the whole point of this demo: swap the base URL and model name, and the exact same LangGraph/tool-calling code in this repo would work against a hosted model instead.

## How Ollama fits in

```
 Your app (this repo)  --HTTP-->  Ollama daemon (localhost:11434)  -->  model weights on disk
```

1. You run `ollama pull llama3.2` once. Ollama downloads the model weights and stores them locally.
2. The Ollama daemon runs in the background, listening on port `11434`.
3. Any app — this one, a CLI, a browser extension — can send it a chat-completion-style HTTP request and get a response, the same shape as OpenAI's chat API.

## The code

```ts
// src/llm.ts
import { ChatOllama } from "@langchain/ollama";

export const llm = new ChatOllama({
  baseUrl: "http://localhost:11434", // the standard local Ollama endpoint
  model: "llama3.2",                 // must be pulled first: `ollama pull llama3.2`
  temperature: 0,                    // deterministic output for demos
});
```

- **`ChatOllama`** is LangChain's adapter for talking to an Ollama daemon. It's one of many "chat model" adapters LangChain ships (`ChatOpenAI`, `ChatAnthropic`, `ChatOllama`, ...) that all expose the *same* interface (`.invoke()`, `.bindTools()`, streaming, etc.) regardless of the underlying provider. That uniform interface is why swapping providers later is mostly a one-line change.
- **`baseUrl`** points at the local Ollama server. If you were pointing this at a cloud provider instead, this line (plus the API key) is basically the only thing that would change.
- **`model: "llama3.2"`** — the model must already be pulled locally (`ollama pull llama3.2`) or the request fails. `llama3.2` was chosen specifically because it supports **native tool-calling** in Ollama — not every local model does, and tool-calling is what makes the agent loop in [`src/graph/`](04-langgraph-orchestration.md) possible.
- **`temperature: 0`** makes the model deterministic (always pick the highest-probability next token). For a classroom demo, reproducibility ("the same question gives the same answer every time") matters more than creative variation.

## Where `llm` is used downstream

`llm` itself is never called directly by the HTTP layer. It's *bound* to the available tools in [`src/tools/registry.ts`](../src/tools/registry.ts):

```ts
export const llmWithTools = llm.bindTools(tools);
```

`bindTools` returns a new callable that, on every `.invoke()`, also sends the tool definitions (converted from the Zod schemas in [`rag.ts`](../src/tools/rag.ts) / [`mcp.ts`](../src/tools/mcp.ts)) alongside the message history. This is what lets the model *choose* to respond with a tool call instead of a plain answer — see [LangGraph Orchestration](04-langgraph-orchestration.md) for how that choice drives the agent loop.

## Troubleshooting

- **"connection refused" / ECONNREFUSED** → the Ollama daemon isn't running. Start the Ollama app, or run `ollama serve`.
- **"model not found"** → run `ollama pull llama3.2` (or whichever model string you put in `src/llm.ts`).
- **Tool calls never happen, model just answers in prose** → you likely swapped in a model that doesn't support tool-calling in Ollama. Not every model does; check Ollama's model library for "tools" support.

## Swapping in a different model / provider

- **Different local model**: change `model: "llama3.2"` to any tool-capable model you've pulled (e.g. `"mistral"`), no other code changes needed.
- **Cloud provider instead**: replace `ChatOllama` with e.g. `ChatOpenAI` or `ChatAnthropic` from their respective `@langchain/*` packages, pass an API key, and remove `baseUrl`. Everything downstream (`bindTools`, the graph, the server) is unaffected because it only depends on the shared LangChain chat-model interface.
