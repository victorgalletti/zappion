// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaLibrary } from "./media-library";
import type { Workspace } from "@/hooks/use-session";
import type { ContactAddressRow, MessageRow } from "@/lib/types";
const mocks = vi.hoisted(() => ({ send: vi.fn(), incoming: vi.fn(), query: vi.fn(), contacts: [] as ContactAddressRow[] }));
vi.mock("@/hooks/use-chat", () => ({ useMediaUrl: () => ({ data: undefined }), useSendMessage: () => ({ mutateAsync: mocks.send }) }));
const message = { id: 'file-1', conversation_id: 'source', sender_address: null, agent_id: 'agent', timestamp: '2026-10-14T10:00:00Z', content: { type: 'file', kind: 'image', file: { uri: 'internal://media/organizations/org/attachments/one', mime_type: 'image/png', name: 'teste.png' }, text: 'Legenda' } } as MessageRow;
vi.mock("@/hooks/use-media-library", () => ({
  useMediaLibrary: () => ({ data: { pages: [{ rows: [message], count: 1 }] }, hasNextPage: false }),
  useMediaPeople: () => ({ data: { contacts: mocks.contacts, agents: [], conversations: [{ id: 'dest', address: '5511999999999', organization_address: 'instance', name: 'Destino' }] } }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { from: () => {
  const builder: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'not', 'order', 'limit']) builder[name] = () => builder;
  builder.maybeSingle = mocks.incoming; return builder;
} } }));
const workspace = { organizationId: 'org', agent: { id: 'agent' }, numbers: [] } as unknown as Workspace;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  mocks.send.mockReset(); mocks.incoming.mockReset();
  mocks.contacts = [];
});
async function chooseDestination() {
  fireEvent.click(screen.getByText('Select'));
  fireEvent.click(screen.getByRole('button', { name: 'Select teste.png, You' }));
  fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Forward' }).at(-1)!);
}
describe('media forwarding with mocked database', () => {
  it.each([
    { extra: { name: "Push", saved_name: "Saved", synced: { name: "Address book" } }, expected: "Address book" },
    { extra: { name: "Push", saved_name: "Saved" }, expected: "Saved" },
    { extra: { name: "Push" }, expected: "Push" },
  ])('resolves forwarding destination name as $expected', ({ extra, expected }) => {
    mocks.contacts = [{ address: "5511999999999", organization_address: "instance", extra }];
    render(<MediaLibrary workspace={workspace} onOpenMessage={vi.fn()} />);
    fireEvent.click(screen.getByText('Select'));
    fireEvent.click(screen.getByRole('button', { name: 'Select teste.png, You' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText("Destino")).toBeNull();
  });

  it('blocks destinations without a current 24-hour window', async () => {
    mocks.incoming.mockResolvedValue({ data: { timestamp: '2020-01-01T00:00:00Z' }, error: null });
    render(<MediaLibrary workspace={workspace} onOpenMessage={vi.fn()} />);
    await chooseDestination();
    await waitFor(() => expect(screen.getAllByText(/24-hour window closed/).length).toBeGreaterThan(0));
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('reuses the URI through the composer send path and avoids duplicate retries', async () => {
    mocks.incoming.mockResolvedValue({ data: { timestamp: new Date().toISOString() }, error: null });
    mocks.send.mockResolvedValue({ id: 'sent' });
    render(<MediaLibrary workspace={workspace} onOpenMessage={vi.fn()} />);
    await chooseDestination();
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send.mock.calls[0][0]).toMatchObject({ target: { organizationId: 'org', organizationAddress: 'instance', conversationId: 'dest' }, content: { file: { uri: message.content.type === 'file' ? (message.content.file as { uri: string }).uri : '' }, text: 'Legenda' } });
    expect(mocks.send.mock.calls[0][0].file).toBeUndefined();
    await waitFor(() => expect(screen.getAllByText('Destino: 1 sent.').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Forward' }).at(-1)!);
    await waitFor(() => expect(screen.getAllByText('Destino: 0 sent.').length).toBeGreaterThan(0));
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
