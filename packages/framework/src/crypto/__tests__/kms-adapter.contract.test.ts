import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.js";
import { describeKmsAdapterContract } from "./kms-adapter-contract.js";

describeKmsAdapterContract("InMemoryKmsAdapter", () => new InMemoryKmsAdapter());
