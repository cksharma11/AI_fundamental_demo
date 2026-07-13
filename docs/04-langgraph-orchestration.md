# LangGraph Orchestration (the agentic loop)

**Code:** [`src/graph/state.ts`](../src/graph/state.ts), [`nodes.ts`](../src/graph/nodes.ts), [`router.ts`](../src/graph/router.ts), [`graph.ts`](../src/graph/graph.ts)

## The idea

A plain LLM call is one-shot: send a prompt, get a completion, done. An **agent** is an LLM call wrapped in a loop that can take actions and re-think based on their results, until it decides it's done. **LangGraph** models that loop explicitly as a **graph** — a small state machine where:

- **nodes** are steps that read the current state and return an update to it,
- **edges** define which node runs next,
- a **conditional edge** can route to different next nodes based on the current state (this is what makes it a *loop* rather than a fixed pipeline).

For this app, the graph is deliberately small — two nodes and one decision:

```
        ┌────────────┐
   ┌───▶│   agent    │◀───┐
   │    │ ("think")  │    │
   │    └─────┬──────┘    │
   │          │           │
   │   tool_calls present?│
   │          │           │
 START     yes│  no        │
   │          ▼   ▼        │
   │    ┌──────────┐   END │
   │    │  tools   │       │
   │    │ ("act")  │       │
   │    └────┬─────┘       │
   │         │             │
   └─────────┴─────────────┘
```

`agent` thinks. If it asks for a tool, `tools` runs it and hands control back to `agent`, which thinks again — now with the tool's result in hand. This repeats until `agent` produces a plain answer with no tool calls, at which point the graph reaches `END`.

## State — the agent's short-term memory

```ts
// src/graph/state.ts
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
```

The entire shared state is one field: `messages`, the running conversation transcript (`HumanMessage`, `AIMessage`, `ToolMessage`, ...). Every node receives the *whole* transcript so far and returns only the *new* message(s) it produced — the `reducer` (`existing.concat(incoming)`) is what appends those onto the growing list rather than overwriting it. This is what makes the transcript accumulate: the user's question, the agent's tool request, the tool's result, and the agent's final answer all end up as one ordered history, which is exactly what gets sent back to the LLM on each subsequent turn so it has full context of what's already happened.

If you've used React's `useReducer` or Redux, this is the same pattern: a pure function that says how an incoming update merges into existing state, decoupled from whoever's dispatching the update.

## Nodes — think, then act

### `agentNode` — the "thinking" step

```ts
// src/graph/nodes.ts
export async function agentNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const response = await llmWithTools.invoke([SYSTEM_PROMPT, ...state.messages]);
  return { messages: [response] };
}
```

This sends the system prompt plus the full transcript to `llmWithTools` (the model with the RAG and MCP tools bound — see [Local LLM](02-local-llm.md) and [RAG](05-rag.md)/[MCP](06-mcp.md)). Because tools are bound, the model has a genuine choice on every turn: answer directly, or respond with one or more `tool_calls`. Either way the result is a single new `AIMessage`, which the node returns for the state reducer to append.

### `toolNode` — the "acting" step

```ts
// src/graph/nodes.ts
export async function toolNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls ?? [];

  const toolMessages: ToolMessage[] = [];
  for (const call of toolCalls) {
    const selectedTool = toolsByName.get(call.name);
    if (!selectedTool) {
      toolMessages.push(new ToolMessage({ tool_call_id: call.id ?? "", content: `Error: unknown tool "${call.name}".` }));
      continue;
    }
    const result = await selectedTool.invoke(call.args);
    toolMessages.push(new ToolMessage({ tool_call_id: call.id ?? "", content: String(result) }));
  }
  return { messages: toolMessages };
}
```

LangGraph ships a prebuilt `ToolNode` that does this automatically — it's implemented by hand here so every mechanical step is visible:

1. Read the last message (the `AIMessage` `agentNode` just produced) and pull its `tool_calls`.
2. For each call, look up the matching tool in `toolsByName` (built in [`src/tools/registry.ts`](../src/tools/registry.ts)) and invoke it with the model-supplied arguments.
3. Wrap each result in a `ToolMessage`, tagged with `tool_call_id`.

**Why `tool_call_id` matters:** a single agent turn can request *multiple* tool calls at once (e.g. "check the syllabus and the grading policy"). Each `tool_calls` entry has a unique `id`; carrying that same id onto the corresponding `ToolMessage` is how the model matches results back to the specific request that produced them when it reads the transcript on its next turn. Drop this and a multi-tool-call turn becomes ambiguous.

**Why unknown tools return an error string instead of throwing:** if the model hallucinates a tool name that doesn't exist, that's a normal, recoverable event — not a crash. Feeding `Error: unknown tool "X"` back into the transcript lets the model see the mistake and try something else on its next turn, the same way a human would recover from picking the wrong menu item.

## The router — what turns this into a loop

```ts
// src/graph/router.ts
export function shouldContinue(state: AgentStateType): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const hasToolCalls = (lastMessage.tool_calls ?? []).length > 0;
  return hasToolCalls ? "tools" : END;
}
```

This is the entire "agent" behavior distilled into one `if`. After `agentNode` runs, look at what it produced: tool calls present → go run them (`"tools"`); none → the model gave a final answer, so stop (`END`). Everything else in the graph — the message accumulation, the tool dispatch — exists to support this one branch point.

## Wiring it together

```ts
// src/graph/graph.ts
const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, { tools: "tools", [END]: END })
  .addEdge("tools", "agent");

export const graph = workflow.compile();
```

- `addEdge(START, "agent")` — every invocation begins at `agent`.
- `addConditionalEdges("agent", shouldContinue, {...})` — after `agent` runs, call `shouldContinue` to pick the next node from the given map. This is the graph's only branch.
- `addEdge("tools", "agent")` — a plain (unconditional) edge that always sends control back to `agent` after tools run, so tool output is *always* re-examined by the model rather than returned to the user directly.
- `.compile()` freezes this node/edge topology into a runnable graph object. It doesn't run anything yet — it just validates the graph and returns something you can call `.invoke()` on.

## Where it's actually run

[`src/server.ts`](../src/server.ts) is the only place `graph.invoke()` is called, once per HTTP request:

```ts
const finalState = await graph.invoke(
  { messages: [new HumanMessage(body.prompt)] },
  { recursionLimit: 10 },
);
```

- The initial state seeds `messages` with just the user's question as a `HumanMessage`. From there the graph drives itself — `agent` → maybe `tools` → `agent` → ... — with no code outside the graph needing to know how many rounds it takes.
- **`recursionLimit: 10`** caps the number of node transitions. Without it, a model stuck calling tools in an unproductive cycle (or a bug causing it to never emit a final answer) could loop indefinitely; this turns that failure mode into a bounded error instead of a hung request.
- `finalState.messages` is the complete transcript when the loop reaches `END`; the last message is the model's final `AIMessage`, which the server reads out and returns as the HTTP response body.

### The same graph, observed step by step

`src/server.ts` also calls `graph.stream()` on the exact same compiled `graph`, from `GET /chat/stream`:

```ts
const stream = await graph.stream(
  { messages: [new HumanMessage(query.prompt)] },
  { recursionLimit: 10, streamMode: "updates" },
);
for await (const chunk of stream) { /* chunk.agent or chunk.tools */ }
```

`.invoke()` and `.stream()` run identical graphs with identical logic — the only difference is *when* you get to see the state. `.invoke()` waits for `END` and hands back the final result once. `.stream()`, with `streamMode: "updates"`, yields one chunk after every node finishes: `{ agent: { messages: [...] } }` right after `agentNode` returns, `{ tools: { messages: [...] } }` right after `toolNode` returns. Nothing about the graph's topology or behavior changes; `/chat/stream` is simply narrating the same think → act → think loop out loud, one node at a time, so the [console UI](01-client-server.md#streaming-the-agent-loop-live) can animate it live instead of only showing the end result.

## Mental model recap

| LangGraph concept | In this repo |
|---|---|
| State | `messages: BaseMessage[]` — the conversation transcript |
| Node | `agentNode` (think), `toolNode` (act) |
| Edge | `tools -> agent` (always loop back) |
| Conditional edge | `agent -> (tools \| END)` via `shouldContinue` |
| Compiled graph | `graph` — the thing `.invoke()` is called on |
| One invocation | One HTTP `/chat` request, potentially several agent/tool rounds internally |

See [RAG](05-rag.md) and [MCP](06-mcp.md) for what the two tools actually do, and [Client/Server](01-client-server.md) for how an HTTP request turns into a `graph.invoke()` call.
