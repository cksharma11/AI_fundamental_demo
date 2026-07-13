/**
 * ============================================================================
 * 2a. ragTool — simulates Retrieval-Augmented Generation
 * ============================================================================
 *
 * Real RAG: embed the query -> nearest-neighbour search in a vector DB ->
 * stitch the retrieved chunks into the prompt. Here we skip the vectors and use
 * a static map, but the *contract* the LLM sees is identical: "give me a query,
 * I hand back relevant document text." That contract is the part students need
 * to internalise; the embedding math is an implementation detail behind it.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

const KNOWLEDGE_BASE: Record<string, string> = {
  "grading policy":
    "Grades are weighted 40% projects, 30% final exam, 20% quizzes, 10% participation. " +
    "A passing grade is 60% or above. Late work loses 10% per day.",
  "ai class schedule":
    "The AI class meets Mondays and Wednesdays 10:00-11:30 in Room 204. " +
    "Office hours are Fridays 14:00-16:00.",
};

export const ragTool = tool(
  async ({ query }): Promise<string> => {
    // Naive "retrieval": lowercase the query and look for any known key that
    // appears inside it. A real system would embed `query` and rank by cosine
    // similarity — the return shape (a text passage) would be the same.
    const normalized = query.toLowerCase();
    for (const [key, passage] of Object.entries(KNOWLEDGE_BASE)) {
      if (normalized.includes(key)) {
        return `RETRIEVED CONTEXT for "${key}":\n${passage}`;
      }
    }
    return `No documents matched "${query}". Available topics: ${Object.keys(
      KNOWLEDGE_BASE,
    ).join(", ")}.`;
  },
  {
    name: "knowledge_base_search",
    description:
      "Retrieve authoritative school documents (RAG). Use this for questions " +
      "about the grading policy or the AI class schedule.",
    // The Zod schema below becomes the JSON Schema the model must satisfy.
    schema: z.object({
      query: z.string().describe("The user's question or search phrase."),
    }),
  },
);
