import { z } from "zod";

/**
 * Shared constraints. 8-char minimum follows current NIST guidance
 * (length over composition rules); 128-char cap is a sanity limit, not a
 * security control — argon2 itself has no practical length weakness, this
 * just avoids accepting pathologically large inputs.
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .email("Enter a valid email address.");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be at most 128 characters.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(200, "Full name is too long."),
  phone: z
    .string()
    .trim()
    .min(5, "Enter a valid phone number.")
    .max(32, "Phone number is too long.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export type LoginInput = z.infer<typeof loginSchema>;
