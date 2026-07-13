/**
 * ============================================================================
 * 2c. Tool registry — wires the tools above to the LLM
 * ============================================================================
 */

import type { StructuredToolInterface } from "@langchain/core/tools";
import { SystemMessage } from "@langchain/core/messages";
import { llm } from "../llm.js";
import { ragTool } from "./rag.js";
import { mcpServerTool } from "./mcp.js";

// A registry the tool node uses to route a tool_call name -> implementation.
// Keeping this as a lookup map (rather than a big switch) means adding a tool
// is a one-line change and the routing code never has to be touched again.
export const tools: StructuredToolInterface[] = [ragTool, mcpServerTool];
export const toolsByName = new Map<string, StructuredToolInterface>(
  tools.map((t) => [t.name, t]),
);

// Bind the tool schemas to the model. After this, every LLM call includes the
// tool definitions, so the model can *choose* to emit a tool_call instead of a
// final answer. This binding is what turns a chat model into an agent.
export const llmWithTools = llm.bindTools(tools);

// A system message steers the model toward using tools rather than guessing.
// It is injected at call time (see graph/nodes.ts) rather than stored in state,
// so the conversation history stays clean and the instruction is never duplicated.
export const SYSTEM_PROMPT = new SystemMessage(
  "You are a helpful classroom assistant. When a question concerns the grading " +
    "policy or class schedule, call knowledge_base_search. When it concerns a " +
    "local file (syllabus, roster, readme), call read_local_file. Prefer tools " +
    "over guessing, then answer using the retrieved information.",
);
