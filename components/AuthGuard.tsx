"use client";

import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";

const AUTH_KEY = "cc-auth-valid";

/**
 * Sets the localStorage validation flag.
 * Call this after successful sign-in.
 */
export function markAuthValid() {
  try {
    localStorage.setItem(AUTH_KEY, "1");
  } catch {
    // localStorage unavailable
  }
}

/**
 * Clears the localStorage validation flag.
 * Called automatically on sign-out.
 */
export function clearAuthValid() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // localStorage unavailable
  }
}

/**
 * Checks if the localStorage auth flag exists.
 * If the user cleared their cache (which clears localStorage but not
 * HttpOnly cookies), this will return false while the session cookie
 * still exists — triggering a forced sign-out.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;

    try {
      const valid = localStorage.getItem(AUTH_KEY);
      if (!valid) {
        // Session cookie exists but localStorage flag is gone —
        // user cleared their cache. Force sign-out.
        signOut({ callbackUrl: "/auth/signin" });
      }
    } catch {
      // localStorage unavailable — skip check
    }
  }, [status]);

  return <>{children}</>;
}
