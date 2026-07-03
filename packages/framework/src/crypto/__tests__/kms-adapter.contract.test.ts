import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import { describeKmsAdapterContract } from "./kms-adapter-contract";

describeKmsAdapterContract("InMemoryKmsAdapter", () => new InMemoryKmsAdapter());
