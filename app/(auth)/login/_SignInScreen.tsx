"use client";

// The real sign-in screen's interactive part (Step 2 PR 2.5; AU-01 PROPOSED): the shared
// LoginForm, whose submit calls the server action `signIn` (passed in by the page). On success the
// action redirects and never returns; on failure this keeps the email the user typed (never the
// password, which LoginForm empties after every call) and shows one of the two generic messages:
// "failed" (every credential failure) or "retry" (every service failure, the form kept).
import { useState } from "react";
import { LoginForm } from "@/components/ui/LoginForm";
import { LoginScreen } from "@/components/ui/LoginScreen";
import type { LoginState } from "@/features/auth/login-state";
import type { SignInFailure } from "@/features/auth/sign-in-input";

export function SignInScreen({ action, next }: { action: (input: unknown) => Promise<SignInFailure>; next: string | null }) {
  const [state, setState] = useState<Extract<LoginState, "form" | "failed" | "retry">>("form");
  const [email, setEmail] = useState("");

  async function submit(values: { email: string; password: string }) {
    setEmail(values.email);
    let result: SignInFailure | undefined;
    try {
      result = await action({ email: values.email, password: values.password, next });
    } catch {
      // The request did not complete (offline, server error): a service failure.
      setState("retry");
      return;
    }
    // A redirect (success) leaves the page; only a returned failure lands here.
    if (result && result.ok === false) setState(result.kind === "service" ? "retry" : "failed");
  }

  return <LoginScreen state={state} form={<LoginForm initialEmail={email} onSubmit={submit} />} />;
}
