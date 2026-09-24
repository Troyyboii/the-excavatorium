// @ts-expect-error -- Bun's runner provides the test module at runtime.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { supabase } from "@/lib/supabase";
import { LoginScreen } from "./login-screen";

afterEach(() => cleanup());

const authError = (code: string, status = 400) => ({ code, status, name: "AuthApiError" });

async function fill(user: ReturnType<typeof userEvent.setup>, email: string, password?: string) {
  await user.type(screen.getByLabelText("Email"), email);
  if (password !== undefined) await user.type(screen.getByLabelText("Password"), password);
}

describe("LoginScreen", () => {
  test("offers sign-up and describes a private, empty archive with no key required", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your archive" })).toBeTruthy();
    expect(screen.getByText(/starts empty/i)).toBeTruthy();
    expect(screen.getByText(/No AI provider key is needed/i)).toBeTruthy();
  });

  test("sign-up with a confirmation requirement shows the neutral notice", async () => {
    const signUp = spyOn(supabase.auth, "signUp").mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    } as never);
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await fill(user, "new@example.test", "long-enough-pw");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("If this address"),
    );
    expect(signUp).toHaveBeenCalledTimes(1);
    const args = signUp.mock.calls[0]?.[0] as {
      email: string;
      options?: { emailRedirectTo?: string };
    };
    expect(args.email).toBe("new@example.test");
    expect(args.options?.emailRedirectTo).toBe(window.location.origin);
    signUp.mockRestore();
  });

  test("an already-registered address gets the same notice as a new one", async () => {
    const signUp = spyOn(supabase.auth, "signUp").mockResolvedValue({
      data: { user: null, session: null },
      error: authError("user_already_exists", 422),
    } as never);
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await fill(user, "taken@example.test", "long-enough-pw");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("If this address"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain("already");
    signUp.mockRestore();
  });

  test("a too-short password is rejected before any request", async () => {
    const signUp = spyOn(supabase.auth, "signUp");
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    await fill(user, "new@example.test", "short");
    // jsdom-style constraint validation is not applied by happy-dom submit; the handler guards it.
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(signUp).not.toHaveBeenCalled();
    signUp.mockRestore();
  });

  test("sign-in failure never says which credential was wrong", async () => {
    const signIn = spyOn(supabase.auth, "signInWithPassword").mockResolvedValue({
      data: { user: null, session: null },
      error: authError("invalid_credentials"),
    } as never);
    const user = userEvent.setup();
    render(<LoginScreen />);
    await fill(user, "someone@example.test", "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Email or password is incorrect."),
    );
    signIn.mockRestore();
  });

  test("forgot password gives the same answer whether or not the request fails", async () => {
    for (const error of [null, authError("over_email_send_rate_limit", 429)]) {
      const reset = spyOn(supabase.auth, "resetPasswordForEmail").mockResolvedValue({
        data: {},
        error,
      } as never);
      const warn = spyOn(console, "warn").mockImplementation(() => undefined);
      const user = userEvent.setup();
      render(<LoginScreen />);
      await user.click(screen.getByRole("button", { name: "Forgot password?" }));
      await user.type(screen.getByLabelText("Email"), "maybe@example.test");
      await user.click(screen.getByRole("button", { name: "Send reset link" }));
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain("If an account exists"),
      );
      expect(reset.mock.calls[0]?.[1]).toEqual({ redirectTo: window.location.origin });
      reset.mockRestore();
      warn.mockRestore();
      cleanup();
    }
  });

  test("the magic-link fallback never creates accounts", async () => {
    const otp = spyOn(supabase.auth, "signInWithOtp").mockResolvedValue({
      data: {},
      error: null,
    } as never);
    const user = userEvent.setup();
    render(<LoginScreen />);
    await user.type(screen.getByLabelText("Email"), "maybe@example.test");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await waitFor(() => expect(otp).toHaveBeenCalled());
    expect(
      (otp.mock.calls[0]?.[0] as { options: { shouldCreateUser: boolean } }).options
        .shouldCreateUser,
    ).toBe(false);
    otp.mockRestore();
  });
});
