import { describe, expect, test } from "bun:test";
import { authMessages } from "./auth-messages";

describe("auth messages do not reveal whether an account exists", () => {
  test("sign-in failures for unknown email and wrong password are identical", () => {
    const unknown = authMessages.signIn({ code: "invalid_credentials", status: 400 });
    const wrong = authMessages.signIn({ code: "invalid_credentials", status: 400 });
    expect(unknown).toBe(wrong);
    expect(unknown).toBe("Email or password is incorrect.");
    expect(authMessages.signIn({ message: "User not found" })).toBe(unknown);
  });

  test("unconfirmed email and rate limits are stated plainly", () => {
    expect(authMessages.signIn({ code: "email_not_confirmed" })).toContain("Confirm your email");
    expect(authMessages.signIn({ status: 429 })).toContain("Too many attempts");
  });

  test("an already-registered address looks like a normal pending sign-up", () => {
    const already = authMessages.signUp({ code: "user_already_exists", status: 422 });
    expect(already).toEqual({ kind: "notice", text: authMessages.signUpCheckEmail });
    expect(already.text.toLowerCase()).not.toContain("already");
    expect(authMessages.signUp({ message: "User already registered" })).toEqual(already);
  });

  test("only weak-password, rate-limit, closed-signup and bad-address are stated", () => {
    expect(authMessages.signUp({ code: "weak_password" }).kind).toBe("error");
    expect(authMessages.signUp({ code: "over_email_send_rate_limit" }).kind).toBe("error");
    expect(authMessages.signUp({ code: "signup_disabled" }).text).toContain("not open");
    expect(authMessages.signUp({ code: "email_address_invalid" }).text).toContain("valid email");
  });

  test("reset and magic-link messages are conditional, never confirmations of existence", () => {
    expect(authMessages.resetRequested).toContain("If an account exists");
    expect(authMessages.magicLinkRequested).toContain("If this address");
  });
});
