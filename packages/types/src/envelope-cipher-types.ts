import type { KeyScope } from "./secrets-types.js";

export type EnvelopeCipher = {
  encrypt(plaintext: string, scope?: KeyScope): Promise<string>;
  decrypt(stored: string, scope?: KeyScope): Promise<string>;
};
