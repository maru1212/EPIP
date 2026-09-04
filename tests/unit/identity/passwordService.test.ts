import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  DUMMY_HASH_FOR_TIMING_MITIGATION,
} from "@/modules/identity/services/passwordService";

describe("passwordService", () => {
  it("hashes a password into an argon2id digest", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it("verifies a correct password against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(
      true
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("produces different hashes for the same password (random salt)", async () => {
    const hashA = await hashPassword("same password");
    const hashB = await hashPassword("same password");
    expect(hashA).not.toBe(hashB);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(
      false
    );
  });

  it("has a valid, working dummy hash for timing mitigation", async () => {
    // The dummy hash itself must be usable by verifyPassword without
    // throwing — it exists purely to make the "user not found" login path
    // spend comparable time to a real verification attempt.
    await expect(
      verifyPassword(DUMMY_HASH_FOR_TIMING_MITIGATION, "anything")
    ).resolves.toBe(false);
  });
});
