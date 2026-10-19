// SPDX-License-Identifier: AGPL-3.0-only
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { DEFAULT_PREFERENCES, setPreferences } from "@/lib/preferences";
import { ConfirmDialog } from "./confirm-dialog";

beforeEach(() => { act(() => setPreferences(DEFAULT_PREFERENCES)); });

it("labels the dialog, traps focus, cancels with Escape/backdrop and restores trigger focus", () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open</button>{open && <ConfirmDialog title="Delete key?" description="This cannot be undone." confirmLabel="Delete" onCancel={() => setOpen(false)} onConfirm={() => {}} />}</>;
  }
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("alertdialog", { name: "Delete key?" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("This cannot be undone.");
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  const confirm = within(dialog).getByRole("button", { name: "Delete" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(confirm);
  fireEvent.keyDown(confirm, { key: "Tab" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("alertdialog").parentElement!);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("shows pending feedback and an actionable error after failure", () => {
  const onConfirm = vi.fn();
  const props = { title: "Revoke key?", description: "Apps will stop working.", confirmLabel: "Revoke", onConfirm, onCancel: vi.fn() };
  const view = render(<ConfirmDialog {...props} pending />);
  const working = screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement;
  expect(working.disabled).toBe(true);
  expect(working.getAttribute("aria-busy")).toBe("true");
  view.rerender(<ConfirmDialog {...props} error="Permission denied" />);
  expect(screen.getByRole("alert").textContent).toBe("Permission denied");
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
