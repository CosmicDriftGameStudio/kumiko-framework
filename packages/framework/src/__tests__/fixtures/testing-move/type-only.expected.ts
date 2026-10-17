import type { TestStack, TestStackOptions } from "@cosmicdrift/kumiko-testing/stack";
import { type RequestHelper, createRequestHelper as makeHelper } from "@cosmicdrift/kumiko-testing/stack";
import type { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";

export type Probe = [TestStack, TestStackOptions, RequestHelper, typeof TestUsers];
export const helper = makeHelper;
