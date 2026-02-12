"use client";

import { LogIn, LogOut } from "lucide-react";

interface AuthButtonProps {
  user?: { name?: string | null; email?: string | null } | null;
  onSignIn: () => void;
  onSignOut: () => void;
}

export function AuthButton({ user, onSignIn, onSignOut }: AuthButtonProps) {
  if (user) {
    return (
      <button
        onClick={onSignOut}
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted hover:text-foreground transition-colors"
      >
        <LogOut size={16} />
        <span className="hidden sm:inline">{user.email}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onSignIn}
      className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/80 transition-colors"
    >
      <LogIn size={16} />
      Sign In
    </button>
  );
}
