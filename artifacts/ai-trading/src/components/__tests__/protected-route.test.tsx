/**
 * ProtectedRoute: web TP khusus staff. User biasa melihat halaman
 * "akses ditolak"; admin & super_admin melihat konten.
 */
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { ProtectedRoute } from "../protected-route";
import {
  installFetchMock,
  jsonResponse,
  makeWrapper,
  TEST_USER,
} from "../../pages/__tests__/test-helpers";

function asRole(role: "user" | "admin" | "super_admin") {
  return (url: string) =>
    url.includes("/api/auth/me") ? jsonResponse({ ...TEST_USER, role }) : null;
}

function renderGate(requiredRole?: "admin" | "super_admin") {
  const { Wrapper } = makeWrapper();
  return render(
    <Wrapper>
      <ProtectedRoute requiredRole={requiredRole}>
        <p>staff content</p>
      </ProtectedRoute>
    </Wrapper>,
  );
}

describe("ProtectedRoute (staff-only web)", () => {
  it("shows the access-denied page for a plain user", async () => {
    installFetchMock([asRole("user")], { strict: false });
    renderGate();
    expect(await screen.findByTestId("staff-access-denied")).toBeInTheDocument();
    expect(screen.queryByText("staff content")).toBeNull();
  });

  it("renders content for an admin", async () => {
    installFetchMock([asRole("admin")], { strict: false });
    renderGate();
    expect(await screen.findByText("staff content")).toBeInTheDocument();
  });

  it("renders content for a super_admin", async () => {
    installFetchMock([asRole("super_admin")], { strict: false });
    renderGate();
    expect(await screen.findByText("staff content")).toBeInTheDocument();
  });

  it("keeps super_admin-only pages hidden from an admin", async () => {
    installFetchMock([asRole("admin")], { strict: false });
    const { container } = renderGate("super_admin");
    await waitFor(() => expect(container.querySelector(".animate-spin")).toBeNull());
    expect(screen.queryByText("staff content")).toBeNull();
    expect(screen.queryByTestId("staff-access-denied")).toBeNull();
  });
});
