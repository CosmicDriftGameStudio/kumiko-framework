import type { TestStack, TestStackOptions } from "@cosmicdrift/kumiko-framework/stack";
import { type RequestHelper, createRequestHelper as makeHelper } from "@cosmicdrift/kumiko-framework/stack";
import type { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

export type Probe = [TestStack, TestStackOptions, RequestHelper, typeof TestUsers];
export const helper = makeHelper;
