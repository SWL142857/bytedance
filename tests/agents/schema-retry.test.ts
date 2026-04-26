import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  completeWithSchemaRetry,
  buildSafeRetryPrompt,
  SchemaRetryFailedError,
  type SchemaRetryErrorKind,
} from "../../src/agents/base-agent.js";
import type { LlmClient, LlmResponse } from "../../src/llm/client.js";
import type { ResumeParserOutput } from "../../src/agents/schemas.js";
import { parseResumeParserOutput } from "../../src/agents/schemas.js";

const VALID_RESUME_PARSER_OUTPUT: ResumeParserOutput = {
  facts: [{ factType: "skill", factText: "Python", sourceExcerpt: null, confidence: "high" }],
  parseStatus: "success",
};

function mockClient(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    async complete(request: { promptTemplateId: string; prompt: string }): Promise<LlmResponse> {
      const idx = Math.min(callIndex, responses.length - 1);
      const content = responses[idx]!;
      callIndex++;
      return { content, promptTemplateId: request.promptTemplateId };
    },
  };
}

describe("completeWithSchemaRetry — happy path", () => {
  it("returns parsed output on first success, retryCount=0", async () => {
    const client = mockClient([JSON.stringify(VALID_RESUME_PARSER_OUTPUT)]);
    const result = await completeWithSchemaRetry(
      client,
      "resume_parser_v1",
      "test prompt",
      parseResumeParserOutput,
    );
    assert.deepEqual(result.parsed, VALID_RESUME_PARSER_OUTPUT);
    assert.equal(result.retryCount, 0);
  });

  it("only calls client once when first attempt succeeds", async () => {
    let callCount = 0;
    const client: LlmClient = {
      async complete(req) {
        callCount++;
        return {
          content: JSON.stringify(VALID_RESUME_PARSER_OUTPUT),
          promptTemplateId: req.promptTemplateId,
        };
      },
    };

    await completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput);
    assert.equal(callCount, 1);
  });
});

describe("completeWithSchemaRetry — invalid JSON retry", () => {
  it("retries once and succeeds when first output is invalid JSON", async () => {
    const client = mockClient([
      "not valid json {{{",
      JSON.stringify(VALID_RESUME_PARSER_OUTPUT),
    ]);

    const result = await completeWithSchemaRetry(
      client,
      "resume_parser_v1",
      "test prompt",
      parseResumeParserOutput,
    );

    assert.deepEqual(result.parsed, VALID_RESUME_PARSER_OUTPUT);
    assert.equal(result.retryCount, 1);
  });

  it("throws SchemaRetryFailedError when both attempts produce invalid JSON", async () => {
    const client = mockClient(["bad json 1", "bad json 2"]);

    await assert.rejects(
      () => completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput),
      (err: unknown) => {
        assert.ok(err instanceof SchemaRetryFailedError);
        assert.equal(err.errorKind, "json_parse");
        assert.ok(err.message.includes("not valid JSON"));
        return true;
      },
    );
  });
});

describe("completeWithSchemaRetry — schema validation retry", () => {
  it("retries once and succeeds when first output is schema-invalid", async () => {
    const client = mockClient([
      JSON.stringify({ facts: "not_an_array" }),
      JSON.stringify(VALID_RESUME_PARSER_OUTPUT),
    ]);

    const result = await completeWithSchemaRetry(
      client,
      "resume_parser_v1",
      "test prompt",
      parseResumeParserOutput,
    );

    assert.deepEqual(result.parsed, VALID_RESUME_PARSER_OUTPUT);
    assert.equal(result.retryCount, 1);
  });

  it("throws SchemaRetryFailedError when both attempts are schema-invalid", async () => {
    const client = mockClient([
      JSON.stringify({ recommendation: "bad_value" }),
      JSON.stringify({ facts: "still_bad" }),
    ]);

    await assert.rejects(
      () => completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput),
      (err: unknown) => {
        assert.ok(err instanceof SchemaRetryFailedError);
        assert.equal(err.errorKind, "schema_validation");
        assert.ok(err.message.includes("schema"));
        return true;
      },
    );
  });
});

describe("completeWithSchemaRetry — retry prompt safety", () => {
  it("retry prompt does not contain original prompt text", async () => {
    const secretPrompt = "super-confidential-resume-with-ssn-123-45-6789";
    const prompts: string[] = [];
    const client: LlmClient = {
      async complete(req) {
        prompts.push(req.prompt);
        if (prompts.length === 1) {
          return { content: "bad json", promptTemplateId: req.promptTemplateId };
        }
        return { content: JSON.stringify(VALID_RESUME_PARSER_OUTPUT), promptTemplateId: req.promptTemplateId };
      },
    };

    await completeWithSchemaRetry(client, "resume_parser_v1", secretPrompt, parseResumeParserOutput);

    assert.equal(prompts.length, 2);
    assert.ok(!prompts[1]!.includes(secretPrompt), "Retry prompt must not contain original prompt");
  });

  it("retry prompt does not contain raw model output", async () => {
    const badOutput = "raw-model-output-with-secret-key-sk-12345";
    const prompts: string[] = [];
    const client: LlmClient = {
      async complete(req) {
        prompts.push(req.prompt);
        if (prompts.length === 1) {
          return { content: badOutput, promptTemplateId: req.promptTemplateId };
        }
        return { content: JSON.stringify(VALID_RESUME_PARSER_OUTPUT), promptTemplateId: req.promptTemplateId };
      },
    };

    await completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput);

    assert.equal(prompts.length, 2);
    assert.ok(!prompts[1]!.includes(badOutput), "Retry prompt must not contain raw model output");
  });

  it("retry prompt contains valid JSON instruction", async () => {
    const prompts: string[] = [];
    const client: LlmClient = {
      async complete(req) {
        prompts.push(req.prompt);
        if (prompts.length === 1) {
          return { content: "bad json", promptTemplateId: req.promptTemplateId };
        }
        return { content: JSON.stringify(VALID_RESUME_PARSER_OUTPUT), promptTemplateId: req.promptTemplateId };
      },
    };

    await completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput);

    assert.ok(prompts[1]!.includes("JSON"), "Retry prompt should mention JSON");
  });

  it("retry prompt does not contain apiKey/endpoint/payload", async () => {
    const prompts: string[] = [];
    const client: LlmClient = {
      async complete(req) {
        prompts.push(req.prompt);
        if (prompts.length === 1) {
          return { content: "bad json", promptTemplateId: req.promptTemplateId };
        }
        return { content: JSON.stringify(VALID_RESUME_PARSER_OUTPUT), promptTemplateId: req.promptTemplateId };
      },
    };

    await completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput);

    const retryPrompt = prompts[1]!;
    assert.ok(!retryPrompt.includes("sk-"), "No API key patterns");
    assert.ok(!retryPrompt.includes("api.test"), "No endpoint patterns");
    assert.ok(!retryPrompt.includes("Bearer"), "No authorization patterns");
  });
});

describe("completeWithSchemaRetry — failure output safety", () => {
  it("SchemaRetryFailedError does not contain raw model output", async () => {
    const client = mockClient(["invalid json {broken", "still broken }}}"]);

    await assert.rejects(
      () => completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput),
      (err: unknown) => {
        assert.ok(err instanceof SchemaRetryFailedError);
        assert.ok(!err.message.includes("invalid json"));
        assert.ok(!err.message.includes("still broken"));
        return true;
      },
    );
  });

  it("SchemaRetryFailedError does not contain original prompt", async () => {
    const secretPrompt = "resume-with-phone-number-555-1234";
    const client = mockClient(["bad json", "bad json 2"]);

    await assert.rejects(
      () => completeWithSchemaRetry(client, "resume_parser_v1", secretPrompt, parseResumeParserOutput),
      (err: unknown) => {
        assert.ok(err instanceof SchemaRetryFailedError);
        assert.ok(!err.message.includes(secretPrompt));
        return true;
      },
    );
  });
});

describe("buildSafeRetryPrompt", () => {
  it("json_parse variant mentions JSON", () => {
    const prompt = buildSafeRetryPrompt("json_parse");
    assert.ok(prompt.includes("JSON"));
    assert.ok(prompt.includes("not valid JSON"));
  });

  it("schema_validation variant mentions schema", () => {
    const prompt = buildSafeRetryPrompt("schema_validation");
    assert.ok(prompt.includes("schema"));
    assert.ok(prompt.includes("did not match"));
  });

  it("does not contain any sensitive patterns", () => {
    for (const kind of ["json_parse", "schema_validation"] as SchemaRetryErrorKind[]) {
      const prompt = buildSafeRetryPrompt(kind);
      assert.ok(!prompt.includes("sk-"));
      assert.ok(!prompt.includes("Bearer"));
      assert.ok(!prompt.includes("api.test"));
      assert.ok(!prompt.includes("endpoint"));
    }
  });
});

describe("completeWithSchemaRetry — deterministic client still works", () => {
  it("DeterministicLlmClient with valid output returns first attempt", async () => {
    const { DeterministicLlmClient } = await import("../../src/llm/deterministic-client.js");
    const client = new DeterministicLlmClient();
    const result = await completeWithSchemaRetry(
      client,
      "resume_parser_v1",
      "test prompt",
      parseResumeParserOutput,
    );
    assert.equal(result.retryCount, 0);
    assert.ok(result.parsed.facts.length > 0);
  });

  it("DeterministicLlmClient with invalid output fails after retry", async () => {
    const { DeterministicLlmClient } = await import("../../src/llm/deterministic-client.js");
    const client = new DeterministicLlmClient({
      resume_parser_v1: "not valid json",
    });
    await assert.rejects(
      () => completeWithSchemaRetry(client, "resume_parser_v1", "test", parseResumeParserOutput),
      (err: unknown) => err instanceof SchemaRetryFailedError,
    );
  });
});
