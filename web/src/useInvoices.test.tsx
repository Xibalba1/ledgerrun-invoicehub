import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "@ledgerrun/contract";

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("./api", () => ({ api: apiMocks }));

import { useInvoices } from "./useInvoices";

const invoice = (id: string, created_at: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id,
  created_at,
  source: { kind: "pdf", filename: `${id}.pdf`, email: null },
  status: "processing",
  stage: "received",
  extracted: null,
  resolved: null,
  matches: null,
  decision: null,
  escalated: false,
  submitted_by: null,
  error: null,
  qc_actions: [],
  timings: {},
  ...overrides,
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closed = false;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

describe("useInvoices", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("applies SSE snapshots and invoice updates, newest first", async () => {
    const rendered = renderHook(() => useInvoices());
    const stream = FakeEventSource.instances[0]!;

    act(() => {
      stream.emit("snapshot", [
        invoice("old", "2026-06-01T00:00:00.000Z"),
        invoice("new", "2026-06-02T00:00:00.000Z"),
      ]);
    });

    await waitFor(() => expect(rendered.result.current.map((i) => i.id)).toEqual(["new", "old"]));

    act(() => {
      stream.emit("invoice", invoice("old", "2026-06-03T00:00:00.000Z", { status: "submitted", stage: "done" }));
    });

    await waitFor(() => expect(rendered.result.current.map((i) => i.id)).toEqual(["old", "new"]));
    expect(rendered.result.current[0]?.status).toBe("submitted");

    rendered.unmount();
    expect(stream.closed).toBe(true);
  });

  it("falls back to polling when the stream errors", async () => {
    vi.useFakeTimers();
    apiMocks.list.mockResolvedValue([invoice("polled", "2026-06-04T00:00:00.000Z")]);
    const { result } = renderHook(() => useInvoices());

    await act(async () => {
      FakeEventSource.instances[0]!.onerror?.();
      await Promise.resolve();
    });

    expect(result.current.map((i) => i.id)).toEqual(["polled"]);
    expect(apiMocks.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(apiMocks.list).toHaveBeenCalledTimes(2);
  });
});
