import * as Tabs from "@radix-ui/react-tabs";
import {useMemo, useRef} from "react";
import {AlertCircle, BriefcaseBusiness, ChevronDown, FileOutput, ListChecks, TerminalSquare} from "lucide-react";
import {Badge, IconButton} from "./ui";

const consoleTimestampPattern = /^\[(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\][ \t]+/;

export type TimestampedConsoleLine = Readonly<{raw: string; rendered: string}>;

export function formatConsoleTimestamp(value = new Date()) {
  const date = Number.isNaN(value.getTime()) ? new Date() : value;
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

export function timestampConsoleLines(entries: readonly string[], value = new Date()) {
  const timestamp = formatConsoleTimestamp(value);
  return entries.flatMap((entry) => String(entry).split(/\r\n|\n|\r/).map((line) => {
    if (!line.trim() || consoleTimestampPattern.test(line)) return line;
    return `[${timestamp}] ${line}`;
  }));
}

export function reconcileConsoleLines(
  entries: readonly string[],
  previous: readonly TimestampedConsoleLine[] = [],
  value = new Date(),
  maximumLines = 250,
): TimestampedConsoleLine[] {
  const rawLines = entries.flatMap((entry) => String(entry).split(/\r\n|\n|\r/)).slice(-maximumLines);
  const retained = retainedConsoleLineIndexes(previous, rawLines);
  const timestamped = timestampConsoleLines(rawLines, value);
  return rawLines.map((raw, index) => ({
    raw,
    rendered: retained.has(index) ? previous[retained.get(index)!].rendered : timestamped[index],
  }));
}

function retainedConsoleLineIndexes(previous: readonly TimestampedConsoleLine[], current: readonly string[]) {
  const lengths = Array.from({length: previous.length + 1}, () => new Uint16Array(current.length + 1));
  for (let previousIndex = previous.length - 1; previousIndex >= 0; previousIndex -= 1) {
    for (let currentIndex = current.length - 1; currentIndex >= 0; currentIndex -= 1) {
      lengths[previousIndex][currentIndex] = previous[previousIndex].raw === current[currentIndex]
        ? lengths[previousIndex + 1][currentIndex + 1] + 1
        : Math.max(lengths[previousIndex + 1][currentIndex], lengths[previousIndex][currentIndex + 1]);
    }
  }
  const retained = new Map<number, number>();
  let previousIndex = 0;
  let currentIndex = 0;
  while (previousIndex < previous.length && currentIndex < current.length) {
    if (previous[previousIndex].raw === current[currentIndex]) {
      retained.set(currentIndex, previousIndex);
      previousIndex += 1;
      currentIndex += 1;
    } else if (lengths[previousIndex + 1][currentIndex] >= lengths[previousIndex][currentIndex + 1]) {
      previousIndex += 1;
    } else {
      currentIndex += 1;
    }
  }
  return retained;
}

export function BottomPanel({logs, open, onToggle}: {logs: string[]; open: boolean; onToggle: () => void}) {
  const previousLogs = useRef<TimestampedConsoleLine[]>([]);
  const visibleLogs = useMemo(() => {
    const reconciled = reconcileConsoleLines(logs, previousLogs.current);
    previousLogs.current = reconciled;
    return reconciled;
  }, [logs]);
  const emptyMessages = useRef<{output: string; logs: string} | null>(null);
  if (!emptyMessages.current) {
    const timestamp = new Date();
    emptyMessages.current = {
      output: timestampConsoleLines(["ModelForge output is ready. Open a run or start a registered job to stream structured logs here."], timestamp)[0],
      logs: timestampConsoleLines(["No runtime logs have been recorded in this session."], timestamp)[0],
    };
  }
  return <div className={`bottom-panel ${open ? "open" : "collapsed"}`}>
    <Tabs.Root defaultValue="output">
      <header><Tabs.List><Tabs.Trigger value="output"><TerminalSquare size={13} /> Output</Tabs.Trigger><Tabs.Trigger value="logs"><FileOutput size={13} /> Logs</Tabs.Trigger><Tabs.Trigger value="problems"><AlertCircle size={13} /> Problems <Badge>0</Badge></Tabs.Trigger><Tabs.Trigger value="jobs"><BriefcaseBusiness size={13} /> Jobs</Tabs.Trigger></Tabs.List><IconButton label={open ? "Collapse output panel" : "Expand output panel"} variant="ghost" onClick={onToggle}><ChevronDown className={open ? "" : "rotate-180"} size={15} /></IconButton></header>
      {open && <div className="bottom-panel-content"><Tabs.Content value="output"><pre>{logs.length ? visibleLogs.map((line) => line.rendered).join("\n") : emptyMessages.current.output}</pre></Tabs.Content><Tabs.Content value="logs"><pre>{logs.length ? visibleLogs.map((line) => line.rendered).join("\n") : emptyMessages.current.logs}</pre></Tabs.Content><Tabs.Content value="problems"><div className="bottom-empty"><ListChecks size={18} /><span>No current validation problems.</span></div></Tabs.Content><Tabs.Content value="jobs"><div className="bottom-empty"><BriefcaseBusiness size={18} /><span>Active and durable jobs are projected here by their registered lifecycle.</span></div></Tabs.Content></div>}
    </Tabs.Root>
  </div>;
}
