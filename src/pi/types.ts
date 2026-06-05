export type ToolCall = {
  toolCallId: string;
  tool: string; 
  pod: string; 
  status: "completed" | "failed";
};

export type ChatInput = {
  sessionId: string;
  message: string;
  requestId: string;
};

export type ChatResult = {
  sessionId: string;
  message: string;
  toolCalls: ToolCall[];
};

export interface PiClient {
  runChat(input: ChatInput): Promise<ChatResult>;
}
