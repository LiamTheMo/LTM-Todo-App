"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type SelectChange = (event: { target: { value: string } }) => void;

type CustomSelectProps = {
  children?: ReactNode;
  value?: string;
  onChange: SelectChange;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

type Option = { value: string; label: ReactNode; disabled: boolean };

function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement(child) || child.type !== "option") return [];
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    return [{ value: String(props.value ?? props.children ?? ""), label: props.children, disabled: Boolean(props.disabled) }];
  });
}

function getPlacement(anchor: HTMLElement, height: number) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
  const below = window.innerHeight - rect.bottom - 12;
  const top = below >= Math.min(height, 260) || below >= rect.top - 12 ? rect.bottom + 6 : Math.max(12, rect.top - height - 6);
  return { top, left, width, maxHeight: Math.max(140, Math.min(300, window.innerHeight - top - 12)) };
}

export function CustomSelect({ children, value, onChange, disabled, className, "aria-label": ariaLabel }: CustomSelectProps) {
  const options = optionsFrom(children);
  const currentValue = String(value ?? "");
  const current = options.find(option => option.value === currentValue) ?? options[0];
  const [open, setOpen] = useState(false);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, maxHeight: 300 });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); root.current?.querySelector("button")?.focus(); }
      if (event.key === "Tab") setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    // Capture before React portal events reach the surrounding editor.
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", keydown, true); };
  }, [open]);

  const show = () => {
    if (disabled) return;
    const anchor = root.current?.querySelector("button");
    if (anchor) { setPlacement(getPlacement(anchor, Math.min(options.length * 44 + 12, 300))); setPortalRoot(anchor.closest("dialog")); }
    setOpen(true);
  };
  const choose = (option: Option) => {
    if (option.disabled) return;
    onChange({ target: { value: option.value } });
    setOpen(false);
    root.current?.querySelector("button")?.focus();
  };

  return <div ref={root} className={`customSelect ${className ?? ""}`}>
    <button id={`${id}-trigger`} type="button" className="customSelectTrigger" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => open ? setOpen(false) : show()} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
    }}>
      <span>{current?.label ?? "Choose…"}</span><span className="customSelectChevron" aria-hidden="true">▾</span>
    </button>
    {open && typeof document !== "undefined" && createPortal(<div ref={menu} id={id} className="customSelectMenu" role="listbox" aria-label={ariaLabel} aria-labelledby={`${id}-trigger`} style={{ top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}>
      {options.map(option => <button type="button" role="option" aria-selected={option.value === currentValue} disabled={option.disabled} key={option.value} onClick={() => choose(option)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
          const index = items.indexOf(event.currentTarget);
          items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}>{option.label}</button>)}
    </div>, portalRoot ?? document.body)}
  </div>;
}

function usePicker(open: boolean, setOpen: (value: boolean) => void, root: React.RefObject<HTMLElement | null>) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 300, maxHeight: 300 });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !document.getElementById("custom-field-picker")?.contains(target)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", keydown, true); };
  }, [open, root, setOpen]);
  const show = (height: number) => {
    const anchor = root.current;
    if (anchor) { setPlacement(getPlacement(anchor, height)); setPortalRoot(anchor.closest("dialog")); }
    setOpen(true);
  };
  return { placement, show, portalRoot };
}

function dayFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DateField({ value, min, disabled, clearable = false, onChange, "aria-label": ariaLabel }: {
  value: string; min?: string; disabled?: boolean; clearable?: boolean; onChange: (value: string) => void; "aria-label"?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const date = value ? new Date(`${value}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const { placement, show, portalRoot } = usePicker(open, setOpen, root);
  const selected = value ? new Date(`${value}T12:00:00`) : null;
  const today = dayFromParts(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const monthLength = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + monthLength) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day < 1 || day > monthLength ? "" : dayFromParts(month.getFullYear(), month.getMonth(), day);
  });
  const label = selected ? selected.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "Choose date";

  return <div className={`customField${clearable ? " customFieldClearable" : ""}`} ref={root}>
    <button type="button" className="customFieldTrigger" disabled={disabled} aria-label={ariaLabel ?? label} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
      if (!open) {
        const date = value ? new Date(`${value}T12:00:00`) : new Date();
        setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
        show(330);
      } else setOpen(false);
    }}><span>{label}</span><span aria-hidden="true">▦</span></button>
    {clearable && Boolean(value) && <button type="button" className="dateFieldClearButton" aria-label="Clear date" title="Clear date" disabled={disabled} onClick={() => { onChange(""); setOpen(false); }}>Clear</button>}
    {open && typeof document !== "undefined" && createPortal(<div id="custom-field-picker" className="datePickerPanel" role="dialog" aria-label="Choose date" style={{ top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}>
      <div className="datePickerHeader"><button type="button" aria-label="Previous month" onClick={() => setMonth(date => new Date(date.getFullYear(), date.getMonth() - 1, 1))}>‹</button><strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong><button type="button" aria-label="Next month" onClick={() => setMonth(date => new Date(date.getFullYear(), date.getMonth() + 1, 1))}>›</button></div>
      <div className="datePickerGrid" role="grid">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span role="columnheader" key={day}>{day}</span>)}{cells.map((day, index) => day ? <button type="button" role="gridcell" key={day} aria-label={new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} aria-selected={day === value} aria-current={day === today ? "date" : undefined} disabled={Boolean(min && day < min)} className={`${day === value ? "selected" : ""} ${day === today ? "today" : ""}`.trim()} onClick={() => { onChange(day); setOpen(false); }}>{Number(day.slice(-2))}</button> : <span aria-hidden="true" key={`blank-${index}`} />)}</div>
    </div>, portalRoot ?? document.body)}
  </div>;
}

const clockParts = (value: string) => {
  const [rawHour = "09", rawMinute = "00"] = value.split(":");
  const parsedHour = Number(rawHour);
  const hour = Number.isFinite(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 9;
  return { hour: hour % 12 || 12, minute: Number(rawMinute) || 0, period: hour >= 12 ? "PM" : "AM" };
};
const to24Hour = (hour: number, minute: number, period: string) => `${String(hour % 12 + (period === "PM" ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

export function TimeField({ value, disabled, onChange, "aria-label": ariaLabel }: {
  value: string; disabled?: boolean; onChange: (value: string) => void; "aria-label"?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { placement, show, portalRoot } = usePicker(open, setOpen, root);
  const parts = clockParts(value || "09:00");
  const display = value ? new Date(`2000-01-01T${value}:00`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "Choose time";
  const update = (hour: number, minute: number, period: string) => onChange(to24Hour(hour, minute, period));
  useEffect(() => {
    if (!open) return;
    document.querySelectorAll<HTMLElement>("#custom-field-picker .timePickerColumn").forEach(column => {
      column.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "center" });
    });
  }, [open, value]);

  return <div className="customField" ref={root}>
    <button type="button" className="customFieldTrigger" disabled={disabled} aria-label={ariaLabel ?? display} aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? setOpen(false) : show(280)}><span>{display}</span><span aria-hidden="true">◷</span></button>
    {open && typeof document !== "undefined" && createPortal(<div id="custom-field-picker" className="timePickerPanel" role="dialog" aria-label="Choose time" style={{ top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}>
      <div className="timePickerColumn" role="group" aria-label="Hour">{Array.from({ length: 12 }, (_, i) => i + 1).map(hour => <button type="button" key={hour} aria-pressed={parts.hour === hour} className={parts.hour === hour ? "selected" : ""} onClick={() => update(hour, parts.minute, parts.period)}>{hour}</button>)}</div>
      <div className="timePickerColumn" role="group" aria-label="Minute">{Array.from({ length: 60 }, (_, minute) => minute).map(minute => <button type="button" key={minute} aria-pressed={parts.minute === minute} className={parts.minute === minute ? "selected" : ""} onClick={() => update(parts.hour, minute, parts.period)}>{String(minute).padStart(2, "0")}</button>)}</div>
      <div className="timePickerColumn" role="group" aria-label="AM or PM">{["AM", "PM"].map(period => <button type="button" key={period} aria-pressed={parts.period === period} className={parts.period === period ? "selected" : ""} onClick={() => update(parts.hour, parts.minute, period)}>{period}</button>)}</div>
      <button type="button" className="timePickerDone" onClick={() => setOpen(false)}>Done</button>
    </div>, portalRoot ?? document.body)}
  </div>;
}
