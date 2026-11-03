"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser, hasPermission, NavUser, getActiveLob } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { ShieldAlert } from "lucide-react";

/**
 * Section nav for the Livestock family. Named for the family rather than for
 * Piggery: Dairy areas already render through this shell, and Goat & Sheep and
 * Poultry will too — a shell called "Piggery" that every livestock LOB has to
 * use is exactly the naming this restructure set out to remove.
 *
 * Keys match the last path segment so a route and its tab can never drift.
 */
export const LIVESTOCK_SECTIONS = [
  { key: "register", href: "/livestock", labelKey: "navLivestockRegister" },
  // A page route, not the API path. The breeding controller lives at
  // 'piggery/breeding'; the screen lives at /livestock/breeding. Conflating the
  // two pointed this nav item at a route that does not exist and, because the
  // href dropped out of the nav set, gave the highlight to /livestock instead.
  { key: "breeding", href: "/livestock/breeding", labelKey: "pigBreeding" },
  // The AI Station: semen collection, boar selection and boar condition. Its own page, so the breeding page keeps to the sows.
  { key: "ai-station", href: "/livestock/ai-station", labelKey: "pigAiStation" },
  // Health sits in this family but renders through ProductionPageShell (it is
  // batch-and-animal shaped, not register-shaped), so it has no tab key here —
  // it is listed so the sidebar has one list to render from.
  { key: null, href: "/livestock/health", labelKey: "navLivestockHealth" },
  { key: "facility", href: "/livestock/facility", labelKey: "pigFacilityOccupancy" },
  { key: "analytics", href: "/livestock/analytics", labelKey: "pigHerdAnalytics" },
] as const;

/**
 * Sections kept out of the sidebar for now (3 Nov 2026): their pages and routes are intact, only the menu entries are off. To show
 * one again, take its key out of this list.
 */
const HIDDEN_FROM_MENU: readonly string[] = ["analytics"];

/** What the Livestock menu lists: every section except the ones switched off above. */
export const LIVESTOCK_MENU_SECTIONS = LIVESTOCK_SECTIONS.filter(
  (section) => section.key === null || !HIDDEN_FROM_MENU.includes(section.key),
);

export type LivestockTabKey = Exclude<(typeof LIVESTOCK_SECTIONS)[number]["key"], null>;

export function useLivestockPageState() {
  const router = useRouter();
  const [user, setUser] = useState<NavUser | null>(null);
  const [ready, setReady] = useState(false);
  const [activeLob, setActiveLobState] = useState("PIGGERY");

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setActiveLobState(getActiveLob());
    setReady(true);
  }, [router]);

  const mayView = Boolean(
    user && (
      user.userType === "COMPANY_ADMIN" ||
      user.userType === "TENANT_ADMIN" ||
      user.userType === "OPERATIONAL_ADMIN" ||
      hasPermission(user, "PIGGERY", "ANIMAL", "can_view")
    )
  );

  return { ready, activeLob, mayView };
}

export function LivestockPageShell({
  activeKey,
  hideTitle = false,
  children,
}: {
  activeKey: LivestockTabKey;
  /** The page puts its own title at the top (it changes with the tab), so the section title is not repeated above it. */
  hideTitle?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const { ready, activeLob, mayView } = useLivestockPageState();

  // No context nav here any more. Livestock is a primary group in the sidebar
  // and lists its five sections there, so a second copy of the same five links
  // in a context rail was the same navigation rendered twice. Module shells
  // that are a SINGLE sidebar entry (Inventory, Finance, Master Data) still use
  // the context nav — that is the rule: sidebar children for the two domain
  // groups, context nav for module shells.

  if (!ready) return null;

  if (!mayView) {
    return (
      <ConsolePage size="narrow">
        <PageHeader title={activeLob === "DAIRY" ? t("dairyCowRegister") : t("pigSwineRegister")} sticky={false} />
        <div
          className="flex items-center gap-3 rounded-[var(--radius-lg)] border p-5"
          style={{ borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)", color: "var(--warning)" }}
        >
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("pigAccessRestrictedTitle")}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>{t("accessDeniedContactAdmin")}</p>
          </div>
        </div>
      </ConsolePage>
    );
  }

  // The header names the section the user actually opened. It used to be
  // pinned to the register's title, so /livestock/breeding, /facility and
  // /analytics all announced themselves as the animal register while rendering
  // something else — clicking "Herd Analytics & Parity" and landing on a page
  // headed "Animal Register" reads as a broken link. Titles come from the same
  // labelKeys the sidebar renders, so a tab and its header cannot drift.
  const sectionLabelKey =
    LIVESTOCK_SECTIONS.find((section) => section.key === activeKey)?.labelKey ?? "navLivestockRegister";

  // Only the register has a description of its own. The other three sections
  // already carry their subtitle inside their own panel, so they render the
  // title alone rather than borrowing the register's copy.
  const isRegister = activeKey === "register";
  const isDairy = activeLob === "DAIRY";

  return (
    <ConsolePage>
      {!hideTitle && (
        <PageHeader
          title={isRegister ? (isDairy ? t("dairyCowRegister") : t("pigSwineRegister")) : t(sectionLabelKey)}
          description={
            isRegister ? (isDairy ? t("dairyCowHerdRegisterDesc") : t("pigAnimalRegisterDesc")) : undefined
          }
        />
      )}
      {/* With no section title above it, the page's own header needs the breathing room the title's row gave. */}
      {hideTitle ? <div className="pt-4 sm:pt-6">{children}</div> : children}
    </ConsolePage>
  );
}
