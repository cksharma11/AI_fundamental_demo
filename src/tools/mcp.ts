/**
 * ============================================================================
 * 2b. mcpServerTool — simulates a Model Context Protocol server
 * ============================================================================
 *
 * MCP is a standard for connecting an LLM to external capabilities — the local
 * filesystem, a database, an internal API — through a uniform JSON-RPC 2.0
 * interface. Instead of every app inventing its own glue, an "MCP server"
 * advertises typed tools and the model calls them over that shared protocol.
 *
 * Notice the parallel: the Zod schema here is exactly the kind of parameter
 * definition an MCP server publishes in its JSON-RPC `tools/list` response, and
 * the object the model sends is the `params` of a `tools/call` request. So this
 * mock is not just "a function" — it mirrors the real wire contract, minus the
 * transport. We keep it fully offline by reading from an in-memory file map.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

const MOCK_FILESYSTEM: Record<string, string> = {
  "syllabus.txt":
    "Course: Intro to AI Architectures. Instructor: Prof. Kapoor. Term: Fall.",
  "roster.txt": "Enrolled students: 28. Waitlist: 4.",
  "readme.md": "This machine hosts the classroom demo server. Do not modify.",
};

export const mcpServerTool = tool(
  async ({ fileName }): Promise<string> => {
    // In production this call would cross a JSON-RPC boundary to an MCP server
    // process that has been granted scoped access to the real disk. Here the
    // "disk" is the map above, but the request/response semantics are the same:
    // a validated request in, a text result (or a clear error) out.
    const contents = MOCK_FILESYSTEM[fileName.toLowerCase()];
    if (contents === undefined) {
      return `MCP file error: "${fileName}" not found. Available files: ${Object.keys(
        MOCK_FILESYSTEM,
      ).join(", ")}.`;
    }
    return `MCP file "${fileName}" contents:\n${contents}`;
  },
  {
    name: "read_local_file",
    description:
      "Read a file from the local machine via the (simulated) MCP filesystem " +
      "server. Use this when asked about the syllabus, roster, or readme file.",
    schema: z.object({
      fileName: z
        .string()
        .describe("The exact file name to read, e.g. 'syllabus.txt'."),
    }),
  },
);
