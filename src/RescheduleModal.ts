import { App, FuzzySuggestModal, type FuzzyMatch } from "obsidian";
import { parseQuickAdd } from "./capture/QuickAddParser.js";
import { relativeDayLabel } from "./design/relativeDay.js";
import type { CalendarDate } from "./model/CalendarDate.js";
import { addDays } from "./recurrence/RecurrenceCalculator.js";
import { todayCalendarDate } from "./support/today.js";

/**
 * Wave 2 chunk 11's `D` reschedule palette — a `FuzzySuggestModal` of quick choices,
 * not a custom date widget. The design pass reuses it for every date field the Task
 * sidebar edits (due, scheduled, start), and accepts a typed date too: whatever the
 * quick-add parser reads from the query ("next friday", "oct 20") is offered first.
 */
interface RescheduleOption {
  readonly label: string;
  readonly compute: (today: CalendarDate) => CalendarDate | null;
}

export class RescheduleModal extends FuzzySuggestModal<RescheduleOption> {
  private readonly onChoose: (date: CalendarDate | null) => void;
  private readonly fieldName: string;

  constructor(app: App, onChoose: (date: CalendarDate | null) => void, fieldName = "due") {
    super(app);
    this.onChoose = onChoose;
    this.fieldName = fieldName;
    this.setPlaceholder(`Set ${fieldName} date — or type one, like “next friday”`);
  }

  getItems(): RescheduleOption[] {
    return [
      { label: "Today", compute: (today) => today },
      { label: "Tomorrow", compute: (today) => addDays(1, today) },
      { label: "Next week", compute: (today) => addDays(7, today) },
      { label: `Clear ${this.fieldName} date`, compute: () => null },
    ];
  }

  getSuggestions(query: string): FuzzyMatch<RescheduleOption>[] {
    const matches = super.getSuggestions(query);
    const typed = query.trim().length > 0 ? parseQuickAdd(query).dueDate : null;
    if (typed === null) return matches;
    const option: RescheduleOption = { label: relativeDayLabel(typed, todayCalendarDate()), compute: () => typed };
    return [{ item: option, match: { score: 0, matches: [] } }, ...matches];
  }

  getItemText(item: RescheduleOption): string {
    return item.label;
  }

  onChooseItem(item: RescheduleOption): void {
    this.onChoose(item.compute(todayCalendarDate()));
  }
}
