# Docs

Deep-dive explanations of each concept this demo teaches, in the same order the code reads top-to-bottom (`app.ts` → `src/llm.ts` → `src/tools/` → `src/graph/` → `src/server.ts`).

1. [Client/Server](01-client-server.md) — how an HTTP request from `index.html` becomes a `/chat` response
2. [Local LLM (Ollama)](02-local-llm.md) — running a model on your own machine, no API key
3. [LangChain](03-langchain.md) — the shared building blocks (chat models, messages, tools) LangGraph is built from
4. [LangGraph Orchestration](04-langgraph-orchestration.md) — the think/act agent loop
5. [RAG](05-rag.md) — the knowledge-base-search tool, and what a real RAG pipeline adds on top
6. [MCP](06-mcp.md) — the local-filesystem tool, and what a real MCP server adds on top

Each doc links back to the exact source file(s) it's describing, and calls out explicitly what's simplified for the demo vs. what a production version would add.

See the top-level [README.md](../README.md) for how to install and run the project.
