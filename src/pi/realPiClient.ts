import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { createTools } from "../tools";
import type { ChatInput, ChatResult, PiClient, ToolCall } from "./types";

const PROVIDER = process.env.PI_PROVIDER ?? "google";
const MODEL = process.env.PI_MODEL ?? "gemini-2.5-pro";

const SYSTEM_PROMPT = `you are the most knowledgable assistant`;

export class RealPiClient implements PiClient {
  constructor(
    private readonly getApiKey: () => string | undefined,
    private readonly instanceId = process.env.SERVICE_INSTANCE_ID ?? "api-1",
  ) {}

  async runChat(input: ChatInput): Promise<ChatResult> {
    const recorder: ToolCall[] = [];
    const tools = createTools(recorder, {
      instanceId: this.instanceId,
      requestId: input.requestId,
      sessionId: input.sessionId,
    });

    const agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model: getModel(PROVIDER as never, MODEL as never),
        thinkingLevel: "low",
        tools,
        messages: [],
      },
      getApiKey: this.getApiKey,
      sessionId: input.sessionId,
    });

    await agent.prompt(input.message);

    return {
      sessionId: input.sessionId,
      message: lastAssistantText(agent.state.messages),
      toolCalls: recorder,
    };
  }
}

function lastAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const content = (m as { content: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (text.trim()) return text;
    }
  }
  return "";
}
