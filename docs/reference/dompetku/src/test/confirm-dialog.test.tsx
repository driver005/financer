// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";

function Harness() {
  const ask = useConfirm();
  const [result, setResult] = useState<string>("menunggu");
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await ask.confirm("Catat pembayaran cicilan ke-1?", {
            description: "Paylater Shopee · Rp 312.000",
            confirmLabel: "Ya, catat",
          });
          setResult(ok ? "disetujui" : "ditolak");
        }}
      >
        bayar
      </button>
      <span data-testid="hasil">{result}</span>
      {ask.element}
    </div>
  );
}

describe("useConfirm dialog", () => {
  it("menampilkan dialog dan mengembalikan true saat disetujui", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("bayar"));
    expect(await screen.findByText("Catat pembayaran cicilan ke-1?")).toBeTruthy();
    expect(screen.getByText("Paylater Shopee · Rp 312.000")).toBeTruthy();
    fireEvent.click(screen.getByText("Ya, catat"));
    await waitFor(() => expect(screen.getByTestId("hasil").textContent).toBe("disetujui"));
  });

  it("mengembalikan false saat dibatalkan", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("bayar"));
    fireEvent.click(await screen.findByText("Batal"));
    await waitFor(() => expect(screen.getByTestId("hasil").textContent).toBe("ditolak"));
  });
});
