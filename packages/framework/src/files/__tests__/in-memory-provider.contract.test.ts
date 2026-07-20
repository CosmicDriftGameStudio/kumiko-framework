import { describeFileProviderContract } from "../../testing/file-provider-contract";
import { createInMemoryFileProvider } from "../in-memory-provider";

describeFileProviderContract("InMemoryFileProvider", () => createInMemoryFileProvider());
