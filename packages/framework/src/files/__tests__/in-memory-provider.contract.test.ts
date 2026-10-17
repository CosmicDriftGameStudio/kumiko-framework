import { describeFileProviderContract } from "@cosmicdrift/kumiko-testing/helpers";
import { createInMemoryFileProvider } from "../in-memory-provider.js";

describeFileProviderContract("InMemoryFileProvider", () => createInMemoryFileProvider());
