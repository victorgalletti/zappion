// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import LoginPage from "./page";

const mock = vi.hoisted(() => ({ next: null as string | null, replace: vi.fn(), signIn: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mock.replace }), useSearchParams: () => new URLSearchParams(mock.next ? { next: mock.next } : {}) }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { signInWithPassword: mock.signIn } } }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.signIn.mockResolvedValue({ data: { session: {} }, error: null });
});
it.each([
  ["/chats/two?message=message", "/chats/two?message=message"],
  ["/settings/members", "/settings/members"],
  [null, "/chats"],
  ["https://other.test/chats", "/chats"],
  ["//other.test/chats", "/chats"],
  ["/invalid", "/chats"],
])("signs in and safely returns from next=%s", async (next, destination) => {
  mock.next = next;
  render(<LoginPage />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "agent@test.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledWith(destination));
});
