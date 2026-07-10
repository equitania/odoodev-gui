import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "loading";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  detail?: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, message: string, detail?: string) => string;
  removeToast: (id: string) => void;
  updateToast: (id: string, type: ToastType, message: string, detail?: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message, detail) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, type, message, detail }],
    }));
    if (type !== "loading") {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, 4000);
    }
    return id;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  updateToast: (id, type, message, detail) =>
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, type, message, detail } : t,
      ),
    })),
}));

export function toast(type: ToastType, message: string, detail?: string): string {
  return useToastStore.getState().addToast(type, message, detail);
}

export function toastSuccess(message: string, detail?: string): string {
  return toast("success", message, detail);
}

export function toastError(message: string, detail?: string): string {
  return toast("error", message, detail);
}

export function toastLoading(message: string): string {
  return toast("loading", message);
}

export function toastUpdate(id: string, type: ToastType, message: string, detail?: string) {
  useToastStore.getState().updateToast(id, type, message, detail);
  if (type !== "loading") {
    setTimeout(() => useToastStore.getState().removeToast(id), 4000);
  }
}