import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CUSTOM_TYPE = "machine-access";
const STATUS_TYPE = "machine-access-status";
const RESTRICTED_TOOLS = new Set(["read", "write", "edit", "bash"]);

interface State {
  machineAccess: boolean;
  toolsBeforeRestrict?: string[];
}

export default function (pi: ExtensionAPI) {
  let machineAccess = true;
  let toolsBeforeRestrict: string[] | undefined;

  function persist() {
    pi.appendEntry<State>(CUSTOM_TYPE, { machineAccess, toolsBeforeRestrict });
  }

  function applyTools() {
    if (machineAccess) {
      if (toolsBeforeRestrict) {
        pi.setActiveTools(toolsBeforeRestrict);
        toolsBeforeRestrict = undefined;
      }
      return;
    }

    if (!toolsBeforeRestrict) {
      toolsBeforeRestrict = pi.getActiveTools();
    }
    pi.setActiveTools(toolsBeforeRestrict.filter((name) => !RESTRICTED_TOOLS.has(name)));
  }

  function statusText() {
    const tools = pi.getActiveTools();
    const toolList = tools.length > 0 ? tools.join(", ") : "(none)";
    if (machineAccess) {
      return `Machine access is ON. You can use the machine. Active tools: ${toolList}. The user controls machine access (Ctrl+;). They can turn it off before a message or while you are looping. Do not assume it stays on. If a later turn says it is off, stop using read/write/edit/bash and ask for a follow-up after they toggle.`;
    }
    return `Machine access is OFF. You do not have read, write, edit, or bash. Active tools: ${toolList}. The user controls this (Ctrl+;). They can turn it on before a message or while you are looping. Do not try those tools, and do not assume access stays off. If you need them, ask the user to toggle machine access and send a follow-up.`;
  }

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus(
      "machine-access",
      machineAccess
        ? ctx.ui.theme.fg("success", "machine on")
        : ctx.ui.theme.fg("warning", "machine off"),
    );
  }

  function notify(ctx: ExtensionContext) {
    updateStatus(ctx);
  }

  function toggle(ctx: ExtensionContext) {
    machineAccess = !machineAccess;
    applyTools();
    persist();
    notify(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    machineAccess = true;
    toolsBeforeRestrict = undefined;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE) continue;
      const data = entry.data as State | undefined;
      if (typeof data?.machineAccess !== "boolean") continue;
      machineAccess = data.machineAccess;
      toolsBeforeRestrict = data.toolsBeforeRestrict;
    }

    applyTools();
    notify(ctx);
  });

  // Per-turn, not persisted. Mid-loop toggle is visible on the next LLM call.
  pi.on("context", (event) => ({
    messages: [
      ...event.messages.filter((m) => m.role !== "custom" || m.customType !== STATUS_TYPE),
      {
        role: "custom" as const,
        customType: STATUS_TYPE,
        content: statusText(),
        display: false,
        timestamp: Date.now(),
      },
    ],
  }));

  pi.registerShortcut("ctrl+;", {
    description: "Toggle machine access (read/write/edit/bash)",
    handler: (ctx) => toggle(ctx),
  });

  pi.on("tool_call", (event) => {
    if (machineAccess) return;
    if (!RESTRICTED_TOOLS.has(event.toolName)) return;
    return {
      block: true,
      reason: "Machine access is off. Press Ctrl+; then send a follow-up to use tools.",
    };
  });
}
