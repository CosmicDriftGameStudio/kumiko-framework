import { mock } from "bun:test";

mock.module("@cosmicdrift/kumiko-testing/helpers/real-providers", () => ({ isRealProviderRun: () => true }));
mock.module("@cosmicdrift/kumiko-framework/crypto", () => ({}));
