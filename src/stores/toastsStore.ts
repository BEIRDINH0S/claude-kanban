import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  /** Action label and handler. The toast dismisses itself after the handler
   *  resolves so a click-to-undo feels final. */
  action?: {
    label: string;
    handler: () => void | Promise<void>;
  };
  /** Auto-dismiss timeout in ms. 0 = sticky. */
  ttlMs?: number;
}

interface ToastsState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id"> & { id?: string }) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastsStore = create<ToastsState>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = toast.id ?? `toast-${++counter}-${Date.now()}`;
    const ttl = toast.ttlMs ?? 5000;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    if (ttl > 0) {
      setTimeout(() => get().dismiss(id), ttl);
    }
    return id;
  },

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
