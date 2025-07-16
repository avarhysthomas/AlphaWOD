import React from "react";
import TimetableView from "../components/TimetableView";

export default function Timetable(): React.ReactElement {
  return (
<div className="flex justify-center w-full">
  <div className="w-full max-w-3xl px-4">
        <h1 className="text-8xl font-heading tracking-tight text-bone uppercase mb-2 text-centre">Timetable</h1>
        <TimetableView />
      </div>
    </div>
  );
}
