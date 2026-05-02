/**
 * AuthGate — top-level rendering decision based on `authStore.status`. The
 * tests here mock the heavy children (CliLoginModal, LoginScreen) to focus
 * on the gate's own contract:
 *
 *   loading    → no children, no LoginScreen, just a spinner
 *   logged-out → LoginScreen, no children
 *   logged-in  → children rendered
 *   request-login bus → modal opens
 *   logged-in flip → modal auto-closes
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestLogin } from "../../lib/authBus";
import { useAuthStore } from "../../stores/authStore";
import { AuthGate } from "./AuthGate";

// Stub the heavy children — both pull in Tauri opener / IPC and we only care
// about their presence, not their internals.
vi.mock("./CliLoginModal", () => ({
  CliLoginModal: ({ onClose }: { onClose: () => void; onSuccess: () => void }) => (
    <div data-testid="cli-login-modal">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock("./LoginScreen", () => ({
  LoginScreen: () => <div data-testid="login-screen">login</div>,
}));

describe("<AuthGate />", () => {
  beforeEach(() => {
    useAuthStore.setState({ status: "loading", details: null });
  });

  afterEach(() => {
    useAuthStore.setState({ status: "loading", details: null });
  });

  it("renders a spinner — not children, not LoginScreen — while loading", () => {
    render(
      <AuthGate>
        <div data-testid="app-content">app</div>
      </AuthGate>,
    );
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login-screen")).not.toBeInTheDocument();
  });

  it("renders the LoginScreen when logged-out, and never the children", () => {
    useAuthStore.setState({ status: "logged-out", details: null });
    render(
      <AuthGate>
        <div data-testid="app-content">app</div>
      </AuthGate>,
    );
    expect(screen.getByTestId("login-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("app-content")).not.toBeInTheDocument();
  });

  it("renders children when logged-in", () => {
    useAuthStore.setState({ status: "logged-in", details: null });
    render(
      <AuthGate>
        <div data-testid="app-content">app</div>
      </AuthGate>,
    );
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
    expect(screen.queryByTestId("login-screen")).not.toBeInTheDocument();
  });

  it("opens the CliLoginModal when requestLogin() fires", () => {
    useAuthStore.setState({ status: "logged-out", details: null });
    render(
      <AuthGate>
        <div>app</div>
      </AuthGate>,
    );
    expect(screen.queryByTestId("cli-login-modal")).not.toBeInTheDocument();

    act(() => {
      requestLogin();
    });

    expect(screen.getByTestId("cli-login-modal")).toBeInTheDocument();
  });

  it("auto-closes the modal when status flips to logged-in (covers external sign-ins)", () => {
    useAuthStore.setState({ status: "logged-out", details: null });
    render(
      <AuthGate>
        <div data-testid="app-content">app</div>
      </AuthGate>,
    );
    act(() => {
      requestLogin();
    });
    expect(screen.getByTestId("cli-login-modal")).toBeInTheDocument();

    // Simulate the auth-changed event landing while the modal is open
    // (e.g. user ran `claude login` from a terminal in parallel).
    act(() => {
      useAuthStore.setState({ status: "logged-in", details: null });
    });

    expect(screen.queryByTestId("cli-login-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-content")).toBeInTheDocument();
  });
});
