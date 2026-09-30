import { describeFileProviderContract } from "../../testing/file-provider-contract.js";
import { createInMemoryFileProvider } from "../in-memory-provider.js";

describeFileProviderContract("InMemoryFileProvider", () => createInMemoryFileProvider());
