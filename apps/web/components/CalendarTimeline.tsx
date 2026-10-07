"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CalendarTimelineItem } from "../lib/calendar-timeline-items";
export type { CalendarTimelineItem } from "../lib/calendar-timeline-items";

const hourHeight = 52;
const minuteOfDay = (instant: string) => {
  const value = new Date(instant);
  return value.getHours() * 60 + value.getMinutes();
};
const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function CalendarTimeline({ day, items, now }: { day: string; items: CalendarTimelineItem[]; now: Date }) {
  const scroller = useRef<HTMLDivElement>(null);
  const laidOut = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id));
    const clusters: CalendarTimelineItem[][] = [];
    let cluster: CalendarTimelineItem[] = [];
    let clusterEnd = "";
    for (const item of sorted) {
      if (cluster.length && item.start >= clusterEnd) {
        clusters.push(cluster);
        cluster = [];
        clusterEnd = "";
      }
      cluster.push(item);
      if (item.end > clusterEnd) clusterEnd = item.end;
    }
    if (cluster.length) clusters.push(cluster);
    return clusters.flatMap(group => {
      const columnEnds: string[] = [];
      const placed = group.map(item => {
        const start = minuteOfDay(item.start);
        const column = columnEnds.findIndex(end => minuteOfDay(end) <= start);
        const index = column < 0 ? columnEnds.length : column;
        columnEnds[index] = item.end;
        return { ...item, column: index };
      });
      return placed.map(item => ({ ...item, columnCount: columnEnds.length }));
    });
  }, [items]);

  useEffect(() => {
    const hour = new Date().getHours();
    if (scroller.current && day === localDay(new Date())) {
      scroller.current.scrollTop = Math.max(0, (hour - 1) * hourHeight);
    }
  }, [day]);

  const isToday = day === localDay(now);
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  return <div className="calendarTimeline" ref={scroller} role="region" aria-label={`${day} day timeline`}>
    <div className="calendarTimelineContent" style={{ height: hourHeight * 24 }}>
      {Array.from({ length: 24 }, (_, hour) => <div className="calendarTimelineHour" style={{ top: hour * hourHeight }} key={hour}>
        <span>{new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" })}</span>
      </div>)}
      <div className="calendarTimelineEvents">
      {laidOut.map(item => {
        const start = minuteOfDay(item.start);
        let end = minuteOfDay(item.end);
        if (end <= start) end = 24 * 60;
        return <div className="calendarTimelineItem" key={item.id}
          style={{ backgroundColor: `color-mix(in srgb, ${item.color} 18%, white)`, borderColor: item.color, top: start / 60 * hourHeight, height: Math.max(34, (end - start) / 60 * hourHeight),
            left: `${item.column / item.columnCount * 100}%`, width: `${100 / item.columnCount}%` }}
          aria-label={`${item.title}, ${item.caption}`}>
          <strong>{item.title}</strong><small>{item.caption}</small>
        </div>;
      })}
      </div>
      {isToday && <div className="calendarNowLine" style={{ top: nowMinute / 60 * hourHeight }} role="status" aria-label={`Current time ${timeLabel(now.toISOString())}`}>
        <span>Now · {timeLabel(now.toISOString())}</span><i /><b />
      </div>}
    </div>
  </div>;
}

function timeLabel(instant: string) {
  return new Date(instant).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
