"use client";

import { useState, type ReactNode } from "react";

/** Native disclosure keeps every settings group reachable by touch and keyboard. */
export function SettingsSection({ title, description, initiallyOpen = false, children }: {
  title: string;
  description: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details className="settingsSection" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="settingsSectionSummary">
      <h3>{title}</h3><span className="settingsSectionDescription">{description}</span>
    </summary>
    <div className="settingsSectionBody">{children}</div>
  </details>;
}
