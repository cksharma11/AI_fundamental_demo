/**
 * ============================================================================
 * 3a/3b. The graph's two nodes — "thinking" and "acting"
 * ============================================================================
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { llmWithTools, toolsByName, SYSTEM_PROMPT } from "../tools/registry.js";
import type { AgentStateType } from "./state.js";

// ---------------------------------------------------------------------------
// 3a. agentNode — the "thinking" step
// ---------------------------------------------------------------------------
//
// Sends the running transcript to the LLM. The model either produces a final
// answer (plain AIMessage) or asks to use a tool (AIMessage with tool_calls).
// We return only the new message; the reducer appends it to state for us.
export async function agentNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const response = await llmWithTools.invoke([SYSTEM_PROMPT, ...state.messages]);
  return { messages: [response] };
}

// ---------------------------------------------------------------------------
// 3b. toolNode — the "acting" step (manual, for teaching clarity)
// ---------------------------------------------------------------------------
//
// LangGraph ships a prebuilt ToolNode, but we implement it by hand so students
// can see every mechanical step: read the last message, pull its tool_calls,
// dispatch each to the matching function, and wrap the result in a ToolMessage.
//
// The tool_call_id is critical: it is the thread that ties a specific result
// back to the specific request the model made, so the model can match them up
// when it reads the transcript on the next loop.
export async function toolNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls ?? [];

  const toolMessages: ToolMessage[] = [];
  for (const call of toolCalls) {
    const selectedTool = toolsByName.get(call.name);

    // Defensive branch: if the model hallucinates a tool name, we feed that
    // fact back into the transcript instead of throwing, so the agent can
    // recover on its next turn rather than crashing the whole request.
    if (!selectedTool) {
      toolMessages.push(
        new ToolMessage({
          tool_call_id: call.id ?? "",
          name: call.name,
          content: `Error: unknown tool "${call.name}".`,
        }),
      );
      continue;
    }

    // `call.args` already conforms to the tool's Zod schema (validated by the
    // binding layer), so invocation is safe. The tool returns a plain string.
    const result = await selectedTool.invoke(call.args);
    toolMessages.push(
      new ToolMessage({
        tool_call_id: call.id ?? "",
        name: call.name,
        content: typeof result === "string" ? result : JSON.stringify(result),
      }),
    );
  }

  return { messages: toolMessages };
}
