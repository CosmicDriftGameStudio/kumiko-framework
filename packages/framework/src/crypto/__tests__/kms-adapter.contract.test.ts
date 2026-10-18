import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.ts";
import { describeKmsAdapterContract } from "./kms-adapter-contract.ts";

describeKmsAdapterContract("InMemoryKmsAdapter", () => new InMemoryKmsAdapter());
