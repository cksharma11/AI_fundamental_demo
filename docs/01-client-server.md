# Client/Server

**Code:** [`src/server.ts`](../src/server.ts), [`index.html`](../index.html), [`app.ts`](../app.ts)

## The idea

This is the most familiar concept of the five, and deliberately so — it's the "anchor" students already understand, which the other four ideas (local LLM, orchestration, RAG, MCP) plug into.

- The **server** is a long-running process that listens on a port and answers requests. Here that's [`src/server.ts`](../src/server.ts), listening on `http://localhost:8000`.
- The **client** is whatever sends it requests. Here that's [`index.html`](../index.html) — a static page you open directly in a browser, no build step, that calls the server with `fetch()`.

```
 browser (index.html)  --POST /chat, {prompt}-->        Elysia server (src/server.ts)
                        <--{status, response}---

 browser (index.html)  --GET /chat/stream?prompt=...-->  Elysia server (src/server.ts)
                        <--SSE: phase/tool_call/tool_result/final/done---
```

Everything else in this project — the local LLM, the LangGraph agent loop, the RAG and MCP tools — runs entirely *inside* the handling of a single request to either endpoint. From the client's perspective, none of that internal complexity is visible by default: it sends a prompt, it gets an answer, exactly like calling any other JSON API. `index.html` chooses to *also* surface that internal complexity, live, via the second endpoint — see [Streaming the agent loop live](#streaming-the-agent-loop-live) below — but that's a UI choice, not something `/chat` requires.

## The server

```ts
// src/server.ts (abridged)
const app = new Elysia(isBun ? {} : { adapter: node() })
  .get("/", () => ({ service: "local-ai-architecture-demo", usage: "..." }))
  .post("/chat", async ({ body, set }) => {
    try {
      const finalState = await graph.invoke(
        { messages: [new HumanMessage(body.prompt)] },
        { recursionLimit: 10 },
      );
      const finalMessage = finalState.messages[finalState.messages.length - 1];
      return { status: "success", response: /* ...normalized text... */ };
    } catch (error) {
      set.status = 500;
      return { status: "error", response: /* ...message... */ };
    }
  }, { body: t.Object({ prompt: t.String() }) })
  .listen(PORT);
```

- **[Elysia](https://elysiajs.com)** is a lightweight, type-safe HTTP framework (originally Bun-first, with a Node adapter — see below). It's a smaller-footprint alternative to something like Express, with schema validation built in. **If you know Python:** Elysia plays the same role here that **FastAPI** (or Flask) plays in a Python stack — a thin layer that turns function calls into HTTP routes and validates request bodies against a schema before your handler runs. Elysia's `t.Object({ prompt: t.String() })` is directly analogous to a FastAPI Pydantic model on a route's request body. This project doesn't use FastAPI anywhere — it's a TypeScript/Bun stack end-to-end — but if your only frame of reference is Python web frameworks, "Elysia route" ≈ "FastAPI route" is the fastest way to map what you already know onto this code.
- **`GET /`** is a plain health/discovery route — hit it in a browser or with `curl` to confirm the server is up and see usage instructions.
- **`POST /chat`** is the one real endpoint. It takes `{ prompt: string }` and returns `{ status: "success" | "error", response: string }`.
- **`body: t.Object({ prompt: t.String() })`** is request validation *at the boundary*: Elysia rejects any request whose body doesn't have a string `prompt` field before the handler function ever runs. This is the transport-layer equivalent of the Zod schemas on the tools in [RAG](05-rag.md)/[MCP](06-mcp.md) — validate untrusted input as early as possible, in a declarative way, rather than scattering `if (!body.prompt) throw ...` checks through the handler.
- **The `try/catch`** turns any failure inside the agent loop — Ollama not running, the model not pulled, a network blip — into a clean `500` with a readable message, rather than letting a raw stack trace leak to the client.
- **What the handler actually does** is one line: hand the prompt to `graph.invoke(...)` and read back the final answer. All of the "thinking, tool-calling, thinking again" happens inside that call — see [LangGraph Orchestration](04-langgraph-orchestration.md) for the full loop.
- **CORS.** `.use(cors())` (from `@elysiajs/cors`) is registered before any routes. `index.html` is opened as a `file://` page, which the browser treats as a different origin from `http://localhost:8000` — without CORS headers on the response, the browser blocks the client's JavaScript from ever reading it, regardless of whether the server handled the request correctly. This is a browser security policy, not something LangGraph, Ollama, or Elysia's routing has any say in.

### Streaming the agent loop live

`POST /chat` waits for `graph.invoke()` to fully finish, then returns one JSON body — the client sees nothing until the whole think/act/think loop is done. `GET /chat/stream` exists so `index.html` can show the loop *as it happens* instead:

```ts
// src/server.ts (abridged)
.get("/chat/stream", async function* ({ query }) {
  yield sse({ event: "phase", data: { phase: "server", detail: "..." } });

  const stream = await graph.stream(
    { messages: [new HumanMessage(query.prompt)] },
    { recursionLimit: 10, streamMode: "updates" },
  );

  for await (const chunk of stream) {
    if (chunk.agent) { /* emit "tool_call" or "final" based on the agent's response */ }
    else if (chunk.tools) { /* emit "tool_result" for each tool that ran */ }
  }

  yield sse({ event: "done", data: {} });
}, { query: t.Object({ prompt: t.String() }) })
```

- **`graph.stream()` instead of `graph.invoke()`.** `.invoke()` runs the whole graph and hands back only the final state. `.stream()` runs the exact same graph but yields a chunk after every node finishes — `{ agent: {...} }` after the "think" step, `{ tools: {...} }` after the "act" step. This is the same loop described in [LangGraph Orchestration](04-langgraph-orchestration.md); streaming just exposes its intermediate steps instead of only the end result.
- **`async function*` + `sse()`.** Elysia recognizes a generator function as a route handler and, once you call its `sse()` helper on a yielded value, formats the response as a proper `text/event-stream` — each `yield` becomes one `event: ...\ndata: ...\n\n` frame flushed to the client immediately, not buffered until the function returns.
- **GET, not POST.** The browser's native `EventSource` API — the standard way to consume SSE — only supports `GET` with no custom body, so the prompt travels as a query string (`?prompt=...`) instead of a JSON body.
- **Named `"failure"`, not `"error"`.** `EventSource` treats an SSE event literally named `error` as colliding with its own built-in connection-error event, so the server picks a different name for "the graph itself failed" to keep the two unambiguous on the client.
- **`/chat` is untouched.** The streaming endpoint is additive — a second view onto the same `graph`, for the UI's benefit. Any plain HTTP client (`curl`, another service) still gets the simple `POST /chat` contract.

### Running on both Bun and Node

```ts
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const app = new Elysia(isBun ? {} : { adapter: node() })
```

Elysia is built for Bun's native HTTP server, but this project is set up to also run under plain Node (`npm run start:node`, using `ts-node/esm`) so it works regardless of which runtime a student has installed. The `isBun` check detects which runtime is active (Bun always defines a global `Bun` object) and only applies Elysia's `@elysiajs/node` adapter when running under Node. Same file, same code, either runtime — no branching anywhere else in the app.

## The entrypoint

```ts
// app.ts
import { startServer } from "./src/server.js";
startServer();
```

`app.ts` itself does almost nothing — it's intentionally left as the "front door" of the project with a comment map of the five concepts and which file implements each, then calls `startServer()`. This mirrors the original single-file version of the demo, which read top-to-bottom in this same order; splitting into modules kept that reading order intact rather than scattering it.

## The client

[`index.html`](../index.html) is a static page — open it directly in a browser (`open index.html`), no dev server needed. On send, it opens an `EventSource` against the streaming endpoint:

```js
const es = new EventSource(
  "http://localhost:8000/chat/stream?prompt=" + encodeURIComponent(prompt),
);
es.addEventListener("tool_call", (e) => { /* highlight the RAG or MCP node */ });
es.addEventListener("tool_result", (e) => { /* mark it done, log the result */ });
es.addEventListener("final", (e) => { /* render the answer bubble */ });
es.addEventListener("done", () => es.close());
```

Each named event drives two things on the page: an **architecture map** (a row of boxes — Browser, Server, Agent, Local LLM, Tools, RAG, MCP, each labeled with the source file that implements it) where the box for whatever just ran lights up amber then turns green, and a **live trace log** printing each event with a timestamp — the tool name, its arguments, and its result, verbatim from the server. Neither is a canned animation; both are direct renderings of the SSE events described in [Streaming the agent loop live](#streaming-the-agent-loop-live) above. If `EventSource` isn't available, the page falls back to the same plain `fetch()` against `POST /chat` used by `curl`:

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is the grading policy?"}'
```

Either way, the client only ever *renders* what the server reports — it has no independent knowledge of which tools exist or how the graph is wired. You could replace `index.html` with a completely different frontend, a Slack bot, or a CLI, and the server wouldn't need to change at all; a richer client just gets to show more of what was already happening.

## Why this separation matters here specifically

The reason this demo is organized as client/server at all — rather than, say, a single script you run from the terminal — is to make a point that generalizes: the "AI" part of the app (LLM + orchestration + tools) is just *business logic* sitting behind an ordinary HTTP endpoint. Once you've built the `/chat` handler, it's reusable by any client: a browser page, a curl script, a mobile app, another backend service. That's the same reason production LLM apps are built this way — the model and its tools are an implementation detail behind an API contract, not something the client needs to know about.
