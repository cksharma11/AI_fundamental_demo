/**
 * ============================================================================
 *  LOCAL AI ARCHITECTURE — CLASSROOM DEMO  (zero API keys)
 * ============================================================================
 *
 *  This project wires together five ideas students usually meet separately:
 *
 *    1. Client/Server   -> an Elysia HTTP server exposes POST /chat      (src/server.ts)
 *    2. Local LLM       -> ChatOllama talks to Ollama on localhost:11434 (src/llm.ts)
 *    3. Graph orchestration / agentic loop -> LangGraph StateGraph       (src/graph/)
 *    4. RAG (concept)   -> a tool that "retrieves" from a local knowledge map (src/tools/rag.ts)
 *    5. MCP (concept)   -> a tool that stands in for a Model Context Protocol
 *                          server exposing the local filesystem              (src/tools/mcp.ts)
 *
 *  Each module is numbered to match this list, so the whole control flow can
 *  still be read top-to-bottom across files, in the same sequence as before —
 *  this file is now just the entrypoint that starts the server.
 *
 *  Run order at a glance:
 *      HTTP request -> HumanMessage -> [agent node] -> (needs a tool?)
 *          -> [tool node] -> back to [agent node] -> ... -> final AIMessage
 * ============================================================================
 */

import { startServer } from "./src/server.js";

startServer();
