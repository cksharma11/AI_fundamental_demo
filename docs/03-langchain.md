# LangChain (vs. LangGraph)

**Code:** used throughout [`src/llm.ts`](../src/llm.ts), [`src/tools/`](../src/tools/), [`src/graph/nodes.ts`](../src/graph/nodes.ts)

## The idea, in one sentence

**LangChain is the toolbox; LangGraph is one specific tool built from that toolbox for wiring loops.** LangChain gives you standard building blocks for talking to LLMs (a common interface across providers, message types, a way to define callable "tools"). LangGraph is a separate-but-related package that uses those building blocks to let you assemble a *state machine* out of them. This project uses both — LangChain for the individual pieces, LangGraph for gluing those pieces into the think/act loop covered in [LangGraph Orchestration](04-langgraph-orchestration.md).

If you haven't read that doc yet, it's worth reading first — this one is about the *raw materials* LangGraph is built from, not the loop itself.

## Why LangChain exists at all

Without it, talking to an LLM provider means learning that provider's specific SDK, request shape, and response shape — and if you switch providers (OpenAI → Anthropic → a local Ollama model), you rewrite that integration code. LangChain's core idea is to wrap every provider behind the **same interface**, so application code (message history, tool definitions, the agent loop) stays identical no matter which model is actually answering.

```
 Your code (messages in, calls tools, reads answers)
        |
        v
 LangChain's common interface   <-- the part that stays the same
        |
   ┌────┴────┬─────────┬───────────┐
   v         v         v           v
 OpenAI   Anthropic  Ollama    (any other provider)
```

## The three LangChain pieces this project actually uses

### 1. A uniform chat-model interface — `ChatOllama`

```ts
// src/llm.ts
import { ChatOllama } from "@langchain/ollama";
const llm = new ChatOllama({ baseUrl: "...", model: "llama3.2", temperature: 0 });
```

`ChatOllama` is LangChain's adapter for Ollama specifically. `ChatOpenAI` and `ChatAnthropic` are the equivalent adapters for other providers. All of them expose the same methods — `.invoke()`, `.bindTools()`, streaming — so code written against `llm` doesn't know or care which provider is underneath. See [Local LLM](02-local-llm.md) for the full walkthrough.

### 2. Message types — a shared vocabulary for conversation history

Every provider's API has *some* concept of "who said what" in a conversation, but the field names and shapes differ per provider. LangChain normalizes this into a small set of classes used everywhere in this codebase:

| Class | Represents |
|---|---|
| `SystemMessage` | Instructions to the model, not part of the visible conversation (see `SYSTEM_PROMPT` in [`registry.ts`](../src/tools/registry.ts)) |
| `HumanMessage` | Something the user said (created from `body.prompt` in [`server.ts`](../src/server.ts)) |
| `AIMessage` | Something the model said — either a final answer, or a request to call a tool (`tool_calls`) |
| `ToolMessage` | The result of running a tool, tagged with `tool_call_id` so the model can match it to its request |

These are the objects that make up `state.messages` in the LangGraph state — see [`src/graph/state.ts`](../src/graph/state.ts). LangGraph doesn't invent its own message format; it just uses LangChain's.

### 3. `tool()` — turning a function into something an LLM can call

```ts
// src/tools/rag.ts
export const ragTool = tool(
  async ({ query }) => { /* ... */ },
  { name: "knowledge_base_search", description: "...", schema: z.object({ query: z.string() }) },
);
```

`tool()` is a LangChain helper that bundles a function with a `name`, a `description`, and a Zod argument `schema`. LangChain converts the schema to JSON Schema and sends it to the model as part of every request once the tool is bound (via `llm.bindTools([...])`). This is the mechanism that turns a plain chat model into something that can take *actions* — see [RAG](05-rag.md) and [MCP](06-mcp.md) for the two tools built this way in this project, and [LangGraph Orchestration](04-langgraph-orchestration.md) for how `toolNode` dispatches a model's tool call back to the matching function.

## So where does LangGraph come in?

None of the three pieces above involve a loop by themselves — `llm.invoke()` is just one request/response round trip. **LangGraph adds the orchestration layer on top**: a `StateGraph` of nodes and edges that decides, after each model response, whether to loop back with a tool result or stop. It's built *using* LangChain's message types and tool objects, not a replacement for them.

```
 LangChain          →  gives you: chat models, messages, tool()
 LangGraph          →  gives you: StateGraph, nodes, conditional edges — the loop
 This project       →  uses LangChain's pieces, wired into a loop by LangGraph
```

Concretely in this repo:

- [`src/llm.ts`](../src/llm.ts) and [`src/tools/`](../src/tools/) are pure LangChain — no loop, no graph.
- [`src/graph/`](../src/graph/) is where LangGraph enters — it imports the LangChain model/tools and drives them in a cycle.

If you only ever need one LLM call with no tool loop, you'd use LangChain alone and never touch LangGraph. This project needs the loop (the model decides to call a tool, and needs to see the result before answering), which is exactly the case LangGraph is for.

## Further reading

- [Local LLM (Ollama)](02-local-llm.md) — `ChatOllama` in detail
- [LangGraph Orchestration](04-langgraph-orchestration.md) — the state machine built from these pieces
- [RAG](05-rag.md) / [MCP](06-mcp.md) — the two `tool()`-based tools in this project
