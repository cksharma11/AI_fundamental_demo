/**
 * ============================================================================
 * 3d. Wire the graph together and compile it
 * ============================================================================
 *
 * Nodes are vertices; edges define allowed transitions. START -> agent is the
 * entry. The conditional edge from agent branches via shouldContinue. The plain
 * edge tools -> agent closes the loop so tool output is always re-examined by
 * the model. `compile()` freezes this topology into a runnable graph.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "./state.js";
import { agentNode, toolNode } from "./nodes.js";
import { shouldContinue } from "./router.js";

const workflow = new StateGraph(AgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    [END]: END,
  })
  .addEdge("tools", "agent");

export const graph = workflow.compile();
