// SPDX-License-Identifier: AGPL-3.0-only
import { Suspense, type ReactNode } from "react";
import AppShell from "@/components/app-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  // children stays outside the Suspense boundary so a route's notFound() sets a real 404 status.
  return <><Suspense fallback={<div className="h-dvh bg-surface" />}><AppShell /></Suspense>{children}</>;
}
