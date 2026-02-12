"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { clearAuthValid } from "./AuthGuard";

export function LogoutButton() {
  return (
    <button
      onClick={() => {
        clearAuthValid();
        signOut({ callbackUrl: "/auth/signin" });
      }}
      className="text-muted hover:text-foreground p-1 shrink-0"
      title="Sign out"
    >
      <LogOut size={18} />
    </button>
  );
}
