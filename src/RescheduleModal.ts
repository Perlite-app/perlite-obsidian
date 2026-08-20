import { App, FuzzySuggestModal } from "obsidian";
import type { CalendarDate } from "./model/CalendarDate.js";
import { addDays } from "./recurrence/RecurrenceCalculator.js";
import { todayCalendarDate } from "./support/today.js";

/**
 * The `D` reschedule palette (Wave 2 chunk 11, §6's own instruction: "reschedule/move
 * palettes use `FuzzySuggestModal`, not a custom widget"). A small fixed set of
 * relative choices, matching the native app's own quick-reschedule vocabulary rather
 * than a full date picker — a `FuzzySuggestModal` is for *picking from a list*, and a
 * calendar grid isn't naturally that; a real date-picker palette is a reasonable later
 * addition if this fixed set proves too narrow in practice.
 */
interface RescheduleOption {
  readonly label: string;
  readonly compute: (today: CalendarDate) => CalendarDate | null;
}

const OPTIONS: readonly RescheduleOption[] = [
  { label: "Today", compute: (today) => today },
  { label: "Tomorrow", compute: (today) => addDays(1, today) },
  { label: "Next week", compute: (today) => addDays(7, today) },
  { label: "Clear due date", compute: () => null },
];

export class RescheduleModal extends FuzzySuggestModal<RescheduleOption> {
  private readonly onChoose: (date: CalendarDate | null) => void;

  constructor(app: App, onChoose: (date: CalendarDate | null) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Reschedule due date to…");
  }

  getItems(): RescheduleOption[] {
    return [...OPTIONS];
  }

  getItemText(item: RescheduleOption): string {
    return item.label;
  }

  onChooseItem(item: RescheduleOption): void {
    this.onChoose(item.compute(todayCalendarDate()));
  }
}
