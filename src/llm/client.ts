export interface LlmRequest {
  promptTemplateId: string;
  prompt: string;
}

export interface LlmResponse {
  content: string;
  promptTemplateId: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}
