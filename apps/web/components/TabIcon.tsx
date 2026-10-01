export type NavigationSection = "Dashboard" | "Tasks" | "Projects" | "Calendar" | "Settings";

type TabIconProps = { section: NavigationSection };

/** Original LTM Todo navigation marks, drawn as small, crisp vector line art. */
export function TabIcon({ section }: TabIconProps) {
  return (
    <svg className="tabIconArtwork" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {section === "Dashboard" && <>
        <rect x="3" y="3.5" width="18" height="17" rx="2.5" />
        <path d="M3 9h18M11 9v11.5M11 14.5h10M6.6 12.6l1.2 1.2 2-2.2" />
        <circle className="tabIconAccent" cx="15.5" cy="17" r="1.25" />
      </>}
      {section === "Tasks" && <>
        <path d="M8 4.5h8a2 2 0 0 1 2 2V20H6V6.5a2 2 0 0 1 2-2Z" />
        <path d="M9 4.5V3h6v1.5M8.5 10.2l1.4 1.4 2.2-2.4M14.5 10.8h2M8.5 15.2l1.4 1.4 2.2-2.4M14.5 15.8h2" />
        <circle className="tabIconAccent" cx="17.6" cy="6.5" r="1.15" />
      </>}
      {section === "Projects" && <>
        <path d="M4 8.5V6.8A1.8 1.8 0 0 1 5.8 5h5l2 2h5.4A1.8 1.8 0 0 1 20 8.8v1" />
        <path d="M3.5 10h17l-1.4 8.2a2 2 0 0 1-2 1.7H6.9a2 2 0 0 1-2-1.7L3.5 10Z" />
        <path d="M8 13.5h5.5" />
        <circle className="tabIconAccent" cx="16.7" cy="14" r="1.15" />
      </>}
      {section === "Calendar" && <>
        <rect x="3" y="5" width="18" height="16" rx="2.5" />
        <path d="M7.5 3.5v3M16.5 3.5v3M3 9.5h18M7 13h2M12 13h2M17 13h.1M7 17h2M12 17h2" />
        <circle className="tabIconAccent" cx="17" cy="17" r="1.15" />
      </>}
      {section === "Settings" && <>
        <path d="M10 2.8h4l.6 2.1c.4.1.8.3 1.2.5l1.9-1 2.8 2.8-1 1.9c.2.4.4.8.5 1.2l2.1.6v4l-2.1.6c-.1.4-.3.8-.5 1.2l1 1.9-2.8 2.8-1.9-1c-.4.2-.8.4-1.2.5l-.6 2.1h-4l-.6-2.1c-.4-.1-.8-.3-1.2-.5l-1.9 1-2.8-2.8 1-1.9c-.2-.4-.4-.8-.5-1.2l-2.1-.6v-4l2.1-.6c.1-.4.3-.8.5-1.2l-1-1.9 2.8-2.8 1.9 1c.4-.2.8-.4 1.2-.5L10 2.8Z" />
        <circle cx="12" cy="12.9" r="3.1" />
        <circle className="tabIconAccent" cx="12" cy="12.9" r="1.2" />
      </>}
    </svg>
  );
}
