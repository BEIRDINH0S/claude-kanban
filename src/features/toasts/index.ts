/**
 * Public surface of the toasts feature. The component reads the global
 * `toastsStore` directly — anything in the codebase can push a toast by
 * importing `useToastsStore` from `stores/toastsStore`.
 */
export { ToastStack } from "./ToastStack";
