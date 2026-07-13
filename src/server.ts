/**
 * ============================================================================
 * 4. THE CLIENT/SERVER INTERFACE LAYER
 * ============================================================================
 *
 * Elysia is a lightweight, type-safe HTTP framework. The `t.Object` body schema
 * mirrors what Zod does for tools: it rejects malformed requests before our
 * handler ever runs, so the transport layer enforces the same "validate at the
 * boundary" discipline as the agent layer.
 */

import { Elysia, t, sse } from "elysia";
// The Node adapter lets Elysia's .listen() work under Node.js. On Bun, Elysia
// listens natively and this adapter is simply not applied (see runtime check
// below), so the exact same file runs instantly on either runtime.
import { node } from "@elysiajs/node";
// index.html is opened directly as a file:// page, so a request to
// localhost:8000 is cross-origin from the browser's point of view. Without
// this, the browser blocks the response before our JS ever sees it.
import { cors } from "@elysiajs/cors";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { graph } from "./graph/graph.js";

// Both the plain and streaming endpoints need to turn an AIMessage's content
// (string, or structured content blocks) into plain text for the client.
function messageText(message: AIMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

// Detect the runtime: Bun exposes a global `Bun`. On Bun we use Elysia's
// default (native) adapter; on Node we plug in the node adapter so .listen()
// binds a real HTTP server. One file, two runtimes, no code changes needed.
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

const PORT = 8000;

export function startServer() {
  const app = new Elysia(isBun ? {} : { adapter: node() })
    .use(cors())
    .get("/", () => ({
      service: "local-ai-architecture-demo",
      usage: 'POST /chat with JSON body { "prompt": "your question" }',
    }))
    .post(
      "/chat",
      async ({ body, set }) => {
        try {
          // Seed the graph with the user's turn as a HumanMessage. From here the
          // graph drives itself: think, maybe call tools, think again, until it
          // settles on an answer. `recursionLimit` caps runaway loops.
          const finalState = await graph.invoke(
            { messages: [new HumanMessage(body.prompt)] },
            { recursionLimit: 10 },
          );

          // The terminal message is the model's final answer (it has no pending
          // tool_calls, which is why the loop stopped).
          const messages = finalState.messages;
          const finalMessage = messages[messages.length - 1] as AIMessage;
          return { status: "success", response: messageText(finalMessage) };
        } catch (error) {
          // Any failure — Ollama not running, model not pulled, network blip —
          // is surfaced as a clean 500 with a readable message rather than a
          // stack trace leaking to the client.
          set.status = 500;
          const message =
            error instanceof Error ? error.message : "Unknown server error.";
          return { status: "error", response: message };
        }
      },
      {
        // Request validation: the body MUST contain a string `prompt`.
        body: t.Object({
          prompt: t.String(),
        }),
      },
    )
    .get(
      "/chat/stream",
      // A Server-Sent Events endpoint for the console UI in index.html: rather
      // than waiting for graph.invoke() to fully finish, we call graph.stream()
      // and forward each real step of the agent loop to the browser as it
      // happens, so the UI can animate the *actual* think -> act -> think path
      // instead of a generic spinner. `/chat` above is unaffected and still
      // returns a single JSON response for plain HTTP clients (curl, etc.).
      async function* ({ query }) {
        yield sse({
          event: "phase",
          data: { phase: "server", detail: "Server received prompt, seeding LangGraph state." },
        });

        try {
          const stream = await graph.stream(
            { messages: [new HumanMessage(query.prompt)] },
            { recursionLimit: 10, streamMode: "updates" },
          );

          yield sse({
            event: "phase",
            data: { phase: "llm", detail: "Sending transcript to local LLM (Ollama · llama3.2) via LangChain." },
          });

          // Each chunk is keyed by the node that just ran: "agent" (thinking)
          // or "tools" (acting) — see src/graph/nodes.ts. This is the exact
          // same loop /chat runs; we're just observing it node by node.
          for await (const chunk of stream) {
            if (chunk.agent) {
              const agentMessages = chunk.agent.messages ?? [];
              const lastMessage = agentMessages[agentMessages.length - 1] as AIMessage;
              const toolCalls = lastMessage.tool_calls ?? [];

              if (toolCalls.length > 0) {
                for (const call of toolCalls) {
                  yield sse({
                    event: "tool_call",
                    data: { tool: call.name, args: call.args },
                  });
                }
                yield sse({
                  event: "phase",
                  data: { phase: "tools", detail: "Routing tool call(s) through the LangGraph tool node." },
                });
              } else {
                yield sse({
                  event: "final",
                  data: { content: messageText(lastMessage) },
                });
              }
            } else if (chunk.tools) {
              for (const toolMessage of chunk.tools.messages as ToolMessage[]) {
                yield sse({
                  event: "tool_result",
                  data: { tool: toolMessage.name, result: String(toolMessage.content) },
                });
              }
              yield sse({
                event: "phase",
                data: { phase: "llm", detail: "Feeding the tool result back to the LLM for another turn." },
              });
            }
          }
        } catch (error) {
          // Named "failure" rather than "error": EventSource treats an SSE
          // event literally named "error" as ambiguous with its own native
          // connection-error event, so we avoid that collision entirely.
          const message = error instanceof Error ? error.message : "Unknown server error.";
          yield sse({ event: "failure", data: { message } });
        }

        yield sse({ event: "done", data: {} });
      },
      {
        // Request validation: the query string MUST contain a string `prompt`.
        // GET + query string (rather than POST + body) so the browser's native
        // EventSource API — which only supports GET — can consume this directly.
        query: t.Object({
          prompt: t.String(),
        }),
      },
    )
    .listen(PORT);

  // Log a reliable URL from the port we control. `app.server` is a Bun-native
  // field and is not populated under the Node adapter, so we don't read from it.
  console.log(`Classroom AI demo running at http://localhost:${PORT}`);
  console.log(
    `Try: curl -X POST http://localhost:${PORT}/chat -H "Content-Type: application/json" -d '{"prompt":"What is the grading policy?"}'`,
  );

  return app;
}
