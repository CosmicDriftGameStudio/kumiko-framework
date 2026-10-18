import { describeFileProviderContract } from "@cosmicdrift/kumiko-testing/helpers";
import { createInMemoryFileProvider } from "../in-memory-provider.ts";

describeFileProviderContract("InMemoryFileProvider", () => createInMemoryFileProvider());
