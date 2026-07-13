/**
 * ============================================================================
 * 3c. shouldContinue — the conditional router (the actual "loop")
 * ============================================================================
 *
 * After the agent thinks, we inspect its last message. If it asked for tools,
 * route to the tool node; otherwise it produced a final answer, so end. This
 * single decision is what creates the agentic loop: agent -> tools -> agent ->
 * tools -> ... -> end, running as many rounds as the task needs.
 */

import { END } from "@langchain/langgraph";
import type { AIMessage } from "@langchain/core/messages";
import type { AgentStateType } from "./state.js";

export function shouldContinue(state: AgentStateType): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const hasToolCalls = (lastMessage.tool_calls ?? []).length > 0;
  return hasToolCalls ? "tools" : END;
}
