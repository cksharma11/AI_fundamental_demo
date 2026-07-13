# RAG — Retrieval-Augmented Generation

**Code:** [`src/tools/rag.ts`](../src/tools/rag.ts)

## The idea

LLMs only "know" what was in their training data, frozen at whatever date that was collected. They don't know your school's grading policy, your company's internal docs, or anything that changed after training. RAG is the standard fix: instead of hoping the model already knows the answer, you **retrieve** relevant text from your own documents and **augment** the prompt with it before asking the model to answer.

The general RAG pipeline looks like:

```
 user question
      |
      v
 embed the question into a vector  --------\
      |                                     |  (semantic similarity search)
      v                                     |
 vector database of pre-embedded chunks <---/
      |
      v
 top-k most similar chunks (the "retrieved context")
      |
      v
 stuffed into the prompt, alongside the original question
      |
      v
 LLM answers *using* that context instead of guessing
```

The key insight for RAG-as-a-tool (as opposed to RAG baked into every prompt): the model itself decides *when* it needs to retrieve, by calling a tool, rather than every single request always dragging in retrieved context whether it's needed or not.

## What's real vs. simulated in this demo

| Real-world RAG | This demo |
|---|---|
| Documents chunked and embedded into vectors (e.g. via an embedding model) | Skipped entirely |
| Vector database (Pinecone, Chroma, pgvector, ...) for nearest-neighbour search | A plain in-memory `Record<string, string>` |
| Similarity search ranks results by cosine distance | `String.includes()` substring match |
| Retrieved chunks get stitched into the prompt automatically | The LLM calls a tool, and the tool's return value becomes a `ToolMessage` in the transcript |

The **contract** the LLM sees is identical either way: *"give me a query, get back relevant document text."* That contract — not the embedding math — is the part worth internalizing. Swapping the body of `knowledge_base_search` for a real vector-DB lookup would change zero lines anywhere else in this codebase.

## The code

```ts
// src/tools/rag.ts
const KNOWLEDGE_BASE: Record<string, string> = {
  "grading policy": "Grades are weighted 40% projects, 30% final exam, ...",
  "ai class schedule": "The AI class meets Mondays and Wednesdays 10:00-11:30 ...",
};

export const ragTool = tool(
  async ({ query }): Promise<string> => {
    const normalized = query.toLowerCase();
    for (const [key, passage] of Object.entries(KNOWLEDGE_BASE)) {
      if (normalized.includes(key)) {
        return `RETRIEVED CONTEXT for "${key}":\n${passage}`;
      }
    }
    return `No documents matched "${query}". Available topics: ...`;
  },
  {
    name: "knowledge_base_search",
    description:
      "Retrieve authoritative school documents (RAG). Use this for questions " +
      "about the grading policy or the AI class schedule.",
    schema: z.object({
      query: z.string().describe("The user's question or search phrase."),
    }),
  },
);
```

- **`tool(fn, config)`** is LangChain's helper for turning a plain async function into something an LLM can call. It bundles three things together: the function itself, a `name` the model refers to it by, and a `description` the model uses to decide *when* to call it.
- **`schema: z.object({...})`** is a [Zod](https://zod.dev) schema describing the function's arguments. LangChain converts this into JSON Schema and sends it to the model as part of the tool definition. This is the load-bearing part: the model literally cannot call this tool with malformed arguments, because the provider-side tool-calling API enforces the schema — the same discipline TypeScript gives you at compile time, enforced on the model's *runtime* behavior instead.
- **`description`** matters more than it looks. The model decides whether to call a tool, and which one, almost entirely based on reading these descriptions against the user's question — there's no other signal. Vague descriptions produce a model that either never calls tools or calls the wrong one.
- The **naive "retrieval"** (`normalized.includes(key)`) is intentionally dumb so the demo has zero dependencies (no embedding model, no vector store). It also means it's brittle: a query has to contain the literal phrase `"grading policy"` to match. A real system would embed the query and rank candidate chunks by cosine similarity, which is robust to paraphrasing ("how are grades calculated?" would still match).

## How this plugs into the agent loop

`ragTool` doesn't do anything by itself — it's inert until the graph invokes it. The path is:

1. [`src/tools/registry.ts`](../src/tools/registry.ts) adds `ragTool` to the `tools` array and calls `llm.bindTools(tools)`, so the model is told this tool exists on every turn.
2. If the model decides the question needs it, its response comes back as an `AIMessage` with a `tool_calls` entry naming `knowledge_base_search` and the arguments it chose.
3. [`src/graph/nodes.ts`](../src/graph/nodes.ts)'s `toolNode` looks up the tool by name, calls `ragTool.invoke(call.args)`, and wraps the returned string in a `ToolMessage`.
4. That `ToolMessage` is appended to the conversation and sent back to the model, which now has the retrieved passage in its context and can answer from it.

See [LangGraph Orchestration](04-langgraph-orchestration.md) for the full loop, and [MCP](06-mcp.md) for the sibling tool that plays the same role for "external capability" rather than "external knowledge."

## Extending it

- **Add a new topic**: add a key/value pair to `KNOWLEDGE_BASE`. No other change needed — the tool, schema, and description already generalize.
- **Wire in real retrieval**: replace the body of the function with an embedding call + vector store query (e.g. Chroma, pgvector, Pinecone). Keep the same `tool()` wrapper, `name`, and `schema` — everything else in the app is unaffected.
