/**
 * Public surface of the command palette feature. Single root component:
 * the palette renders only when `useUiStore.paletteOpen` is true and is
 * mounted at the App level so it floats above whatever view is active.
 */
export { CommandPalette } from "./CommandPalette";
