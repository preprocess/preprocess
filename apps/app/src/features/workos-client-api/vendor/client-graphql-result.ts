// Vendored from @workos-inc/widgets 1.20.2 (MIT, Copyright (c) 2024 WorkOS),
// src/lib/client-graphql-result.ts. Do not edit; re-vendor to update.
import type { PasswordViolationFieldsFragment } from "./generated";

interface ResultMember {
  __typename: string;
}

interface PasswordPolicyViolationResult extends ResultMember {
  __typename: "PasswordPolicyViolation";
  message: string;
  violations: PasswordViolationFieldsFragment[];
}

class ClientGraphqlResultError extends Error {
  readonly typename: string;

  constructor(typename: string, message: string) {
    super(message);
    this.name = "ClientGraphqlResultError";
    this.typename = typename;
  }
}

export class PasswordPolicyViolationError extends ClientGraphqlResultError {
  readonly violations: PasswordViolationFieldsFragment[];

  constructor(result: PasswordPolicyViolationResult) {
    super(result.__typename, result.message);
    this.name = "PasswordPolicyViolationError";
    this.violations = result.violations;
  }
}

function isResultMember<
  TResult extends ResultMember,
  TTypename extends TResult["__typename"],
>(
  result: TResult,
  typename: TTypename,
): result is Extract<TResult, { __typename: TTypename }> {
  return result.__typename === typename;
}

function isPasswordPolicyViolation(
  result: ResultMember,
): result is PasswordPolicyViolationResult {
  return result.__typename === "PasswordPolicyViolation";
}

/**
 * Narrows a Client GraphQL result union to its success member, throwing a
 * `ClientGraphqlResultError` for any other member so React Query surfaces it
 * through the mutation's `error` state like the REST client did.
 */
export function expectResultMember<
  TResult extends ResultMember,
  TTypename extends TResult["__typename"],
>(
  result: TResult,
  typename: TTypename,
): Extract<TResult, { __typename: TTypename }> {
  if (isResultMember(result, typename)) {
    return result;
  }

  if (isPasswordPolicyViolation(result)) {
    throw new PasswordPolicyViolationError(result);
  }

  throw new ClientGraphqlResultError(
    result.__typename,
    getResultFailureMessage(result.__typename),
  );
}

// Failure members are surfaced as plain strings, matching the untranslated
// server messages the REST endpoints returned.
function getResultFailureMessage(typename: string): string {
  switch (typename) {
    case "ElevatedAccessTokenExpired":
    case "IdentityVerificationExpired":
      return "Your verification has expired. Please verify your identity again.";
    case "ElevatedAccessTokenInvalid":
    case "IdentityVerificationInvalid":
      return "Your verification is no longer valid. Please verify your identity again.";
    case "IncorrectPassword":
      return "Invalid credentials";
    case "UserAlreadyHasPassword":
      return "A password is already set for this account.";
    case "TotpAlreadyEnrolled":
      return "An authenticator app is already set up for this account.";
    case "TotpVerificationFailed":
      return "Invalid passcode";
    case "NoMfaFactorsEnrolled":
      return "No authenticator app is set up for this account.";
    case "VerificationCodeIncorrect":
    case "EmailChangeCodeIncorrect":
      return "Invalid code, please try again.";
    case "VerificationCodeExpired":
    case "EmailChangeCodeExpired":
      return "This code has expired. Please request a new one.";
    case "VerificationCodePreviouslyUsed":
    case "EmailChangeCodePreviouslyUsed":
      return "This code has already been used. Please request a new one.";
    case "VerificationTooManyAttempts":
    case "EmailChangeTooManyAttempts":
      return "Too many attempts. Please request a new code.";
    case "DailyEmailQuotaExceeded":
      return "Too many verification emails have been sent today. Please try again later.";
    case "EmailChangeNotAvailable":
      return "Email change is not available for this account.";
    case "EmailManagedByProvider":
      return "Your email address is managed by your identity provider and cannot be changed.";
    case "EmailNotAvailable":
      return "This email address is not available.";
    case "InvalidEmail":
      return "Please enter a valid email address.";
    case "NoPendingEmailChange":
      return "There is no pending email change to confirm.";
    case "InvalidLocale":
      return "The provided locale is invalid.";
    case "SessionNotFound":
      return "This session could not be found.";
    default:
      return "Something went wrong. Please try again.";
  }
}
