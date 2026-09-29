const days = [
  { label: "TODAY", date: "SEP 29", scheduled: ["9:00 AM · Plan the day", "4:00 PM · Focus block"], due: ["Set up LTM Todo foundation"] },
  { label: "TOMORROW", date: "SEP 30", scheduled: [], due: ["Review upcoming work"] },
  { label: "THURSDAY", date: "OCT 1", scheduled: ["2:00 PM · Project time"], due: [] }
];

export default function Home() {
  return (
    <main className="shell">
      <aside>
        <h1>LTM Todo</h1>
        {["Dashboard", "Inbox", "Tasks", "Projects", "Settings"].map((item) => <button className={item === "Dashboard" ? "active" : ""} key={item}>{item}</button>)}
      </aside>
      <section className="dashboard">
        <header><div><span className="eyebrow">YOUR DAY</span><h2>Dashboard</h2></div><button className="add">+ Add task</button></header>
        <div className="stream">
          {days.map((day) => (
            <article className="day" key={day.date}>
              <div className="dayHeader"><strong>{day.label}</strong><span>{day.date}</span></div>
              {day.scheduled.length > 0 && <div className="group"><small>SCHEDULED</small>{day.scheduled.map(x => <p key={x}>{x}</p>)}</div>}
              {day.due.length > 0 && <div className="group"><small>DUE</small>{day.due.map(x => <p key={x}>○ {x}</p>)}</div>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
