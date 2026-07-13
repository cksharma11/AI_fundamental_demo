# Local AI Architecture Demo

A zero-API-key classroom demo showing how Client/Server, a local LLM (Ollama), LangGraph orchestration, RAG, and MCP tool concepts fit together, with a static HTML console (`index.html`) as the UI.

## How it works

- `app.ts` is a thin entrypoint that starts an Elysia HTTP server (`src/server.ts`) on `http://localhost:8000` exposing `POST /chat` and `GET /chat/stream`.
- Each request runs a LangGraph agent loop (`src/graph/`) backed by a local Ollama model (`src/llm.ts`, `llama3.2`), which can call two mock tools (`src/tools/`): a RAG-style knowledge base search and an MCP-style local file reader.
- `index.html` is a static single-page UI, opened directly in a browser, that drives `/chat/stream` (Server-Sent Events) to show a live architecture map and trace log of the agent loop as it runs — see [Live behind-the-scenes view](#live-behind-the-scenes-view) below.

## Project structure

The code is split into modules, but kept in the same top-to-bottom sequence as the original single-file version so the control flow still reads as one story:

```
app.ts                    # entrypoint — starts the server
src/
  llm.ts                   # 1. local LLM (ChatOllama) setup
  tools/
    rag.ts                 # 2a. RAG-style knowledge base tool
    mcp.ts                 # 2b. MCP-style local filesystem tool
    registry.ts            # 2c. tool registry + bindTools + system prompt
  graph/
    state.ts               # 3a. shared agent state (message history)
    nodes.ts                # 3b. agentNode ("think") + toolNode ("act")
    router.ts              # 3c. shouldContinue — the loop's conditional edge
    graph.ts               # 3d. wires nodes/edges together and compiles the graph
  server.ts                # 4. Elysia HTTP layer (client/server interface)
index.html                 # static UI that calls POST /chat
```

For an in-depth explanation of each concept (Client/Server, Local LLM, LangGraph orchestration, RAG, MCP), see the [`docs/`](docs/README.md) folder.

## Prerequisites

1. **Ollama** installed and running locally.
   - Install: https://ollama.com/download
   - Pull the model used by the demo:
     ```bash
     ollama pull llama3.2
     ```
   - Make sure the Ollama daemon is running (it listens on `http://localhost:11434` by default).

2. A JavaScript runtime — either works, no code changes needed:
   - **Bun** (recommended, simplest): https://bun.sh
   - **Node.js** (v18+)

## Install dependencies

```bash
npm install
```

(This just installs the packages listed in `package.json`; you can run the app with either Bun or Node afterward.)

## Run the server

With **Bun**:
```bash
bun run start
```

With **Node**:
```bash
npm run start:node
```

You should see:
```
Classroom AI demo running at http://localhost:8000
Try: curl -X POST http://localhost:8000/chat -H "Content-Type: application/json" -d '{"prompt":"What is the grading policy?"}'
```

## Try it

**Via curl:**
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is the grading policy?"}'
```

**Via the UI:**
Open `index.html` directly in your browser (double-click it, or `open index.html` on macOS). It talks to `http://localhost:8000`, so the server must already be running.

## Live behind-the-scenes view

`index.html` doesn't just show the final answer — it shows the request actually moving through the system. On send, it opens a Server-Sent Events connection to `GET /chat/stream`, which wraps `graph.stream()` (instead of `graph.invoke()`) so the server can forward each real step of the LangGraph loop as it happens:

- An **architecture map** (Browser → Server → Agent ⇄ Local LLM → Tools → RAG/MCP) lights up amber for the component currently active and green once that step completes — driven entirely by the SSE events, not a canned animation.
- A **live trace log** underneath prints each event as it arrives: which tool was called and with what arguments, what it returned, and when the model got the result back for another turn.

`POST /chat` is untouched and still returns a single `{ status, response }` JSON body — the streaming endpoint is additive, purely for the UI's benefit. See [docs/01-client-server.md](docs/01-client-server.md) and [docs/04-langgraph-orchestration.md](docs/04-langgraph-orchestration.md) for the full explanation of both endpoints and the loop they observe.

## Notes

- `index.html` loads Tailwind from a CDN, so opening it requires internet access once (the app logic itself is fully local/offline).
- The server enables CORS (`@elysiajs/cors`) so the browser can reach `localhost:8000` from a page opened directly as a `file://` URL.
- If you get connection errors, confirm Ollama is running (`ollama list` should show `llama3.2`) and that nothing else is bound to port `8000` or `11434`.
