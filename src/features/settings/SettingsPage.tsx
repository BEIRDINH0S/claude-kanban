/**
 * Settings page orchestrator. Lists the categories + their sections in a
 * reading order ("user-facing toggles → data ops → diagnostics") and lets
 * each sub-feature own its own internals.
 *
 * Adding a new section = drop a sub-folder with an `index.ts` in
 * `features/settings/<your-section>/`, then mount it here. The boundary
 * check ensures sub-features can't reach into each other; if your new
 * section needs to share state with another, lift it to a shared root
 * file (like `layout.tsx`) or — more likely — to a store.
 */
import { AccountSection } from "./account";
import { DefaultWorktreeSection } from "./cards";
import {
  ClaudeRuntimeSection,
  isWindows,
} from "./claude-runtime";
import { ProjectDataSection } from "./data";
import { Category } from "./layout";
import { NotificationsSection } from "./notifications";
import { ReplayTutorialSection } from "./onboarding";
import { PermissionRulesSection } from "./permissions-rules";
import { ShortcutsSection } from "./shortcuts";
import { PromptTemplatesSection } from "./templates";

export function SettingsPage() {
  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 py-6">
        <header>
          <p className="text-[10.5px] font-medium tracking-[0.18em] text-[var(--text-muted)] uppercase">
            Settings
          </p>
          <h1 className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">
            Preferences and data
          </h1>
        </header>

        <Category title="Claude account">
          <AccountSection />
        </Category>

        <Category title="Notifications">
          <NotificationsSection />
        </Category>

        <Category title="Permissions">
          <PermissionRulesSection />
        </Category>

        <Category title="Keyboard shortcuts">
          <ShortcutsSection />
        </Category>

        <Category title="Help">
          <ReplayTutorialSection />
        </Category>

        <Category title="Prompts">
          <PromptTemplatesSection />
        </Category>

        <Category title="Cards">
          <DefaultWorktreeSection />
        </Category>

        {/* Runtime selector is Windows-only — on Mac/Linux WSL doesn't
            exist and `auto` ≡ `native`, so the whole category would be
            noise. Skip it entirely off-Windows. */}
        {isWindows() && (
          <Category title="Claude">
            <ClaudeRuntimeSection />
          </Category>
        )}

        <Category title="Data">
          <ProjectDataSection />
        </Category>
      </div>
    </div>
  );
}
