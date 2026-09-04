import argon2, { type HashOptions } from "argon2";

/**
 * argon2id is the OWASP-recommended password hashing algorithm as of this
 * writing (resistant to both GPU-cracking and side-channel attacks, unlike
 * argon2i/argon2d alone). Explicit here rather than relying on the
 * library's default, since defaults can change between versions.
 */
const HASH_OPTIONS: HashOptions & { raw?: false } = {
  type: argon2.argon2id,
};

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return argon2.hash(plainTextPassword, HASH_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plainTextPassword: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainTextPassword);
  } catch {
    // argon2.verify throws on a malformed/foreign hash rather than
    // returning false — treat that the same as "did not match".
    return false;
  }
}

/**
 * A precomputed, fixed argon2id hash with no corresponding real account.
 * Used only to make the login path do a comparable amount of hashing work
 * when the email doesn't exist, so "no such user" and "wrong password"
 * aren't distinguishable by response time.
 */
export const DUMMY_HASH_FOR_TIMING_MITIGATION =
  "$argon2id$v=19$m=65536,p=4,t=3$y10wexoB8+Y2CvUOiJZsMA$PSjApn1f4kSeTDqcAIlKySUkH+rZwL4Fc4kj6/esv9E";
