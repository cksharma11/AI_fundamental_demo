/**
 * ============================================================================
 * 3. THE LANGGRAPH ORCHESTRATION STATE MACHINE
 * ============================================================================
 *
 * A LangGraph graph is a small state machine: nodes read the shared state and
 * return partial updates to it. Here the state is just the message history,
 * which functions as the agent's SHORT-TERM MEMORY — every node can see the
 * whole conversation so far, and every node's output is appended to it.
 */

import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export const AgentState = Annotation.Root({
  // The `reducer` decides how a node's return value merges into existing state.
  // Using concat (append) rather than replace is exactly what makes this a
  // growing transcript: the agent's answer, the tool results, and the user's
  // question all accumulate instead of overwriting one another.
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
});

// A convenience alias for the fully-resolved state type.
export type AgentStateType = typeof AgentState.State;
