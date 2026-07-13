# MCP — Model Context Protocol

**Code:** [`src/tools/mcp.ts`](../src/tools/mcp.ts)

## The idea

Every LLM application eventually needs the model to reach *outside* the conversation — read a file, query a database, hit an internal API, control a browser. Before MCP, every app invented its own bespoke glue for this: custom tool definitions, custom auth, custom transport, repeated for every integration and every app.

**Model Context Protocol (MCP)** is Anthropic's open standard for that glue. Instead of every app reinventing "how does the model call external stuff," an **MCP server** exposes a set of capabilities (tools, resources, prompts) over a uniform **JSON-RPC 2.0** interface, and *any* MCP-compatible client can talk to it the same way. Write one MCP server for "access to the local filesystem," and every MCP-aware app (Claude Desktop, an IDE, a custom agent) can use it without bespoke integration code.

The core exchange has two parts:

1. **`tools/list`** — the client asks the server "what can you do?" and gets back a list of tool definitions (name, description, JSON Schema for arguments) — conceptually identical to the tool definitions LangChain builds from the `Zod` schemas in this repo.
2. **`tools/call`** — the client sends `{ name, params }`; the server executes it (with whatever real-world access it's been granted) and returns a result.

```
  MCP client (this app, Claude Desktop, ...)
        |  JSON-RPC 2.0 over stdio / HTTP
        v
  MCP server  (grants scoped access to: filesystem, DB, internal API, ...)
        |
        v
  the actual resource (disk, database, network)
```

## What's real vs. simulated in this demo

| Real MCP | This demo |
|---|---|
| A separate server process, started independently, speaking JSON-RPC over stdio or HTTP | No separate process — just a function in the same file |
| `tools/list` response describing available tools | The `description` + Zod `schema` passed to LangChain's `tool()` |
| `tools/call` request crossing a process/security boundary | A direct in-memory function call |
| Server has scoped access to a real resource (e.g. one directory on disk) | An in-memory `Record<string, string>` standing in for "the filesystem" |

Just like [RAG](05-rag.md), the important thing to internalize is the **contract**, not the transport. The object the model sends (`{ fileName: "syllabus.txt" }`) is exactly what would be the `params` of a real `tools/call` JSON-RPC request; the string this function returns is exactly what would come back as the result. This mock skips the wire protocol and the process boundary, but the request/response *shape* is the real thing.

## The code

```ts
// src/tools/mcp.ts
const MOCK_FILESYSTEM: Record<string, string> = {
  "syllabus.txt": "Course: Intro to AI Architectures. Instructor: Prof. Kapoor. Term: Fall.",
  "roster.txt": "Enrolled students: 28. Waitlist: 4.",
  "readme.md": "This machine hosts the classroom demo server. Do not modify.",
};

export const mcpServerTool = tool(
  async ({ fileName }): Promise<string> => {
    const contents = MOCK_FILESYSTEM[fileName.toLowerCase()];
    if (contents === undefined) {
      return `MCP file error: "${fileName}" not found. Available files: ...`;
    }
    return `MCP file "${fileName}" contents:\n${contents}`;
  },
  {
    name: "read_local_file",
    description:
      "Read a file from the local machine via the (simulated) MCP filesystem " +
      "server. Use this when asked about the syllabus, roster, or readme file.",
    schema: z.object({
      fileName: z.string().describe("The exact file name to read, e.g. 'syllabus.txt'."),
    }),
  },
);
```

- Structurally this is identical to [`ragTool`](05-rag.md) — same `tool()` wrapper, same Zod-schema-becomes-JSON-Schema mechanism, same "the model decides when to call it based on the `description`." The *teaching* distinction between this tool and `ragTool` is purely conceptual: one represents pulling in *knowledge* (RAG), the other represents invoking an *external capability* (MCP). Mechanically, from LangChain's and the LLM's point of view, they're the same kind of thing — a named, schema-validated function.
- **Error handling returns a string, not a throw.** If the file isn't found, the function returns an error message *as the tool result* rather than throwing. This matters: the error goes back into the conversation as a `ToolMessage`, so the model sees "file not found, available files are X, Y, Z" and can recover — e.g. by trying a different filename — on its next turn. Throwing would just crash the request.

## How this plugs into the agent loop

Identical path to `ragTool` — see [LangGraph Orchestration](04-langgraph-orchestration.md):

1. Registered in the `tools` array in [`src/tools/registry.ts`](../src/tools/registry.ts) and bound to the model via `llm.bindTools(tools)`.
2. If the model's question is about the syllabus/roster/readme, it emits a `tool_calls` entry naming `read_local_file`.
3. `toolNode` in [`src/graph/nodes.ts`](../src/graph/nodes.ts) dispatches to `mcpServerTool.invoke(call.args)` and wraps the result in a `ToolMessage`.
4. The model reads that result on its next turn and answers from it.

## Going from mock to a real MCP server

To make this a genuine MCP integration rather than a simulation:

1. Run an actual MCP server process — e.g. the [filesystem MCP server](https://github.com/modelcontextprotocol/servers) — scoped to a real directory.
2. Use an MCP client SDK (`@modelcontextprotocol/sdk`) to connect to it and call `tools/list` to discover its tools at startup.
3. Wrap each discovered tool in a LangChain `tool()` the same way `mcpServerTool` is wrapped here, but have its implementation forward the call over the MCP client (`tools/call`) instead of reading the in-memory map.
4. Everything downstream — the `tools` array, `bindTools`, the graph, the tool node's dispatch-by-name logic — needs zero changes, because it only ever depended on the `StructuredToolInterface` shape, not on how the tool's body is implemented.
