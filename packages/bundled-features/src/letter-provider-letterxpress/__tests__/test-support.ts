import { readFileSync } from "node:fs";
import type { LetterProviderContext } from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";

const fixtureSchema = z.object({ http_status: z.number(), body: z.unknown() });
export type Fixture = z.infer<typeof fixtureSchema>;

export function fixture(name: string): Fixture {
  return fixtureSchema.parse(
    JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")),
  );
}

export type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
};

export type StubAnswer = Fixture | Error;

export function responseOf(answer: Fixture): Response {
  return new Response(JSON.stringify(answer.body), {
    status: answer.http_status,
    headers: { "Content-Type": "application/json" },
  });
}

function parsedBodyOf(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  const parsed: unknown = JSON.parse(raw);
  return isPlainObject(parsed) ? parsed : {};
}

/** Answers the queued fixtures in order and records each request. */
export function createStubTransport(answers: StubAnswer[]) {
  const requests: RecordedRequest[] = [];
  const policies: unknown[] = [];
  const queue = [...answers];
  const egress: LetterProviderContext["egress"] = (policy) => {
    policies.push(policy);
    return async (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: parsedBodyOf(init?.body),
      });
      const next = queue.shift();
      if (next === undefined) throw new Error("stub transport has no answer left");
      if (next instanceof Error) throw next;
      return responseOf(next);
    };
  };
  return { egress, requests, policies };
}
