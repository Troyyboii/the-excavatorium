// User-facing copy for the public account lifecycle. The rule for every
// message here: never reveal whether an email address already has an account.
// Supabase itself can be configured either to auto-confirm sign-ups (an
// already-registered address then returns an error) or to require email
// confirmation (an already-registered address then returns an obfuscated
// success). These helpers make both configurations look the same.

export const MIN_PASSWORD_LENGTH = 8;

type AuthLikeError = { code?: string; status?: number; name?: string; message?: string };

function code(error: AuthLikeError): string {
  return typeof error.code === "string" ? error.code : "";
}

const RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
  "over_sms_send_rate_limit",
]);

export const authMessages = {
  passwordTooShort: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,

  signUpCheckEmail:
    "If this address can be used to create an account, a confirmation link is on its way. Open it to finish.",

  resetRequested:
    "If an account exists for that address, a password reset link has been sent. Check your email.",

  magicLinkRequested: "If this address has an account, a sign-in link has been sent.",

  /** Sign-in failures never say which half of the credentials was wrong. */
  signIn(error: AuthLikeError): string {
    const errorCode = code(error);
    if (RATE_LIMIT_CODES.has(errorCode) || error.status === 429) {
      return "Too many attempts. Wait a few minutes and try again.";
    }
    // Supabase only reports an unconfirmed email after the password matched,
    // so this does not disclose anything to someone guessing addresses.
    if (errorCode === "email_not_confirmed") {
      return "Confirm your email address first. Check your inbox for the confirmation link.";
    }
    return "Email or password is incorrect.";
  },

  /**
   * Sign-up failures. A weak password and rate limiting are safe to state.
   * Everything else, including an address that is already registered, becomes
   * the same neutral notice a successful sign-up shows.
   */
  signUp(error: AuthLikeError): { kind: "error" | "notice"; text: string } {
    const errorCode = code(error);
    if (errorCode === "weak_password") {
      return {
        kind: "error",
        text: "That password is too weak. Use a longer or less common password.",
      };
    }
    if (RATE_LIMIT_CODES.has(errorCode) || error.status === 429) {
      return { kind: "error", text: "Too many attempts. Wait a few minutes and try again." };
    }
    if (errorCode === "signup_disabled") {
      return { kind: "error", text: "Account creation is not open right now." };
    }
    if (errorCode === "email_address_invalid" || errorCode === "validation_failed") {
      return { kind: "error", text: "Enter a valid email address." };
    }
    return { kind: "notice", text: authMessages.signUpCheckEmail };
  },
};
