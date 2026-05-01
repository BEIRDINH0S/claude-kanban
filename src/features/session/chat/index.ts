/**
 * Chat sub-feature. The orchestrator (`<ChatTab />`) is the one thing the
 * outside world cares about; everything else (MessageList, MessageInput,
 * the slash menu, the slash command registry, the inline diff for tool_use
 * blocks) is private and consumed only inside this directory.
 *
 * The chat tab takes a `permissionSlot` so the parent (ZoomView) can inject
 * the cross-sub-feature permission row without ChatTab importing it.
 */
export { ChatTab } from "./ChatTab";
