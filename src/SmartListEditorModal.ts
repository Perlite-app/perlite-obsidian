import { App, DropdownComponent, Modal, Setting, setIcon } from "obsidian";
import { calendarDateToISOString, parseCalendarDate } from "./model/CalendarDate.js";
import type { Priority } from "./model/Priority.js";
import { PRIORITY_VALUES } from "./model/Priority.js";
import type { TaskStatusKind } from "./model/TaskStatus.js";
import {
  CRITERION_FIELD_LABEL,
  CRITERION_FIELDS,
  createCriterionDraft,
  criterionDraftFromCriterion,
  DATE_RANGE_KIND_LABEL,
  DATE_RANGE_KINDS,
  flatFilterFromExpression,
  flatFilterToExpression,
  RELATIVE_DATE_RANGE_LABEL,
  RELATIVE_DATE_RANGES,
  type CriterionDraft,
  type CriterionField,
  type DateRangeKind,
  type FlatFilter,
  type MatchMode,
} from "./query/CriterionDraft.js";
import { GROUP_KEY_VALUES, type GroupKey } from "./query/GroupingEngine.js";
import { createSmartList, SMART_LIST_LENS_VALUES, type SmartList, type SmartListLens } from "./query/SmartList.js";
import { SORT_KEY_VALUES, sortCriterion, type SortCriterion, type SortDirection, type SortKey } from "./query/SortCriterion.js";

/**
 * Wave 2 chunk 10's smart-list filter builder — a flat "Match All / Match Any" editor
 * over a list of (optionally negated) criteria, mirroring `SmartListEditorView.swift`'s
 * own deliberate scope: not a nested-group editor, even though `FilterExpression`
 * itself supports arbitrary nesting (see `CriterionDraft.ts`'s doc comment). Built as an
 * Obsidian `Modal` rather than a full view, since it's a short-lived create/edit form,
 * not a persistent screen — the same reasoning any Obsidian plugin's own settings/CRUD
 * modals follow.
 *
 * Accent tokens: a small fixed named palette (`ACCENT_TOKEN_OPTIONS` below), reusing the
 * hues `styles.css` already defines for priority chips — §5's own rule ("both surfaces
 * reference token *names*, neither hand-picks hex") applies here exactly as it does on
 * the native side, just with a smaller palette than that app's 8-swatch one since this
 * plugin doesn't have a dedicated design-token screen to browse a larger set from yet.
 */

const ACCENT_TOKEN_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "smartlist.today", label: "Blue (matches Today)" },
  { value: "smartlist.overdue", label: "Red (matches Overdue)" },
  { value: "smartlist.upcoming", label: "Orange (matches Upcoming)" },
  { value: "smartlist.anytime", label: "Grey (matches Anytime)" },
  { value: "smartlist.flagged", label: "Amber (matches Flagged)" },
  { value: "smartlist.recentlyCompleted", label: "Green (matches Recently completed)" },
];

const STATUS_KIND_OPTIONS: readonly { readonly value: TaskStatusKind; readonly label: string }[] = [
  { value: "todo", label: "Todo" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
  { value: "custom", label: "Custom" },
];

const PRIORITY_LABEL: Readonly<Record<Priority, string>> = {
  highest: "Highest",
  high: "High",
  medium: "Medium",
  normal: "Normal",
  low: "Low",
  lowest: "Lowest",
};

const GROUP_KEY_LABEL: Readonly<Record<GroupKey, string>> = {
  dueDate: "Due date",
  priority: "Priority",
  tag: "Tag",
  file: "File",
  folder: "Folder",
  status: "Status",
};

const LENS_LABEL: Readonly<Record<SmartListLens, string>> = {
  list: "List",
  kanban: "Kanban board",
  calendar: "Calendar",
};

const SORT_KEY_LABEL: Readonly<Record<SortKey, string>> = {
  dueDate: "Due date",
  scheduledDate: "Scheduled date",
  startDate: "Start date",
  priority: "Priority",
  status: "Status",
  description: "Description",
};

export interface SmartListEditorResult {
  readonly list: SmartList;
}

export class SmartListEditorModal extends Modal {
  private readonly onSubmit: (list: SmartList) => void;
  private readonly existing: SmartList | null;

  private name: string;
  private icon: string;
  private accentToken: string;
  private matchMode: MatchMode;
  private rows: CriterionDraft[];
  private readonly unrepresentable: boolean;
  private lens: SmartListLens;
  private grouping: GroupKey | null;
  private primarySort: SortCriterion | null;
  private secondarySort: SortCriterion | null;
  private rowsContainer: HTMLElement | null = null;
  private saveButton: HTMLButtonElement | null = null;

  constructor(app: App, existing: SmartList | null, onSubmit: (list: SmartList) => void) {
    super(app);
    this.existing = existing;
    this.onSubmit = onSubmit;

    this.name = existing?.name ?? "";
    this.icon = existing?.icon ?? "flag";
    this.accentToken = existing?.accentToken ?? ACCENT_TOKEN_OPTIONS[0]!.value;
    this.lens = existing?.lens ?? "list";
    this.grouping = existing?.grouping ?? null;
    this.primarySort = existing?.sorting[0] ?? null;
    this.secondarySort = existing?.sorting[1] ?? null;

    const flat = existing !== null ? flatFilterFromExpression(existing.filter) : { mode: "all" as MatchMode, rows: [] };
    if (flat === null) {
      this.unrepresentable = true;
      this.matchMode = "all";
      this.rows = [];
    } else {
      this.unrepresentable = false;
      this.matchMode = flat.mode;
      this.rows = flat.rows;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.existing === null ? "New smart list" : `Edit "${this.existing.name}"` });

    new Setting(contentEl).setName("Name").addText((text) =>
      text.setValue(this.name).onChange((value) => {
        this.name = value;
        this.refreshSaveEnabled();
      }),
    );

    new Setting(contentEl)
      .setName("Icon")
      .setDesc("A Lucide icon name (e.g. \"flag\", \"star\").")
      .addText((text) => {
        text.setValue(this.icon).onChange((value) => {
          this.icon = value;
          renderIconPreview(previewEl, value);
        });
        const previewEl = text.inputEl.parentElement!.createSpan({ cls: "perlite-icon-preview" });
        renderIconPreview(previewEl, this.icon);
      });

    new Setting(contentEl).setName("Colour").addDropdown((dropdown) => {
      for (const option of ACCENT_TOKEN_OPTIONS) dropdown.addOption(option.value, option.label);
      dropdown.setValue(this.accentToken).onChange((value) => {
        this.accentToken = value;
      });
    });

    contentEl.createEl("h3", { text: "Match" });

    if (this.unrepresentable) {
      contentEl.createDiv({
        cls: "perlite-editor-notice",
        text: "This list's filter is more complex than this editor supports (nested groups or mixed AND/OR). It will be shown here read-only — saving other fields below leaves the filter untouched.",
      });
    } else {
      new Setting(contentEl).setName("Match").addDropdown((dropdown) => {
        dropdown.addOption("all", "All of the following");
        dropdown.addOption("any", "Any of the following");
        dropdown.setValue(this.matchMode).onChange((value) => {
          this.matchMode = value as MatchMode;
        });
      });

      this.rowsContainer = contentEl.createDiv({ cls: "perlite-criteria-rows" });
      this.renderRows();

      new Setting(contentEl).addButton((button) =>
        button.setButtonText("+ Add condition").onClick(() => {
          this.rows.push(createCriterionDraft());
          this.renderRows();
          this.refreshSaveEnabled();
        }),
      );
    }

    contentEl.createEl("h3", { text: "Display" });

    new Setting(contentEl).setName("View as").addDropdown((dropdown) => {
      for (const lens of SMART_LIST_LENS_VALUES) dropdown.addOption(lens, LENS_LABEL[lens]);
      dropdown.setValue(this.lens).onChange((value) => {
        this.lens = value as SmartListLens;
        updateGroupingVisibility();
      });
    });

    // A kanban board's columns come from `grouping` (defaulted to "status" at save time
    // if left unset — see `submit()`); a calendar buckets by due/scheduled date instead
    // and never reads `grouping` at all, so the control is disabled with an inline note
    // rather than left live-but-ignored.
    const groupingSetting = new Setting(contentEl).setName("Group by");
    let groupingDropdown: DropdownComponent | null = null;
    groupingSetting.addDropdown((dropdown) => {
      dropdown.addOption("none", "None");
      for (const key of GROUP_KEY_VALUES) dropdown.addOption(key, GROUP_KEY_LABEL[key]);
      dropdown.setValue(this.grouping ?? "none").onChange((value) => {
        this.grouping = value === "none" ? null : (value as GroupKey);
      });
      groupingDropdown = dropdown;
    });
    const updateGroupingVisibility = (): void => {
      const isCalendar = this.lens === "calendar";
      groupingDropdown?.setDisabled(isCalendar);
      groupingSetting.setDesc(
        isCalendar
          ? "Calendar view groups by due/scheduled date automatically — this setting is unused for it."
          : this.lens === "kanban"
            ? "Becomes the board's columns. Defaults to Status if left as None."
            : "",
      );
    };
    updateGroupingVisibility();

    this.addSortSetting(
      contentEl,
      "Sort by",
      () => this.primarySort,
      (value) => {
        this.primarySort = value;
      },
    );
    this.addSortSetting(
      contentEl,
      "Then by",
      () => this.secondarySort,
      (value) => {
        this.secondarySort = value;
      },
    );

    const buttonRow = new Setting(contentEl);
    buttonRow.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
    buttonRow.addButton((button) => {
      this.saveButton = button.buttonEl;
      button
        .setButtonText(this.existing === null ? "Create" : "Save")
        .setCta()
        .onClick(() => this.submit());
    });
    this.refreshSaveEnabled();
  }

  private addSortSetting(
    container: HTMLElement,
    label: string,
    getCurrent: () => SortCriterion | null,
    setCurrent: (value: SortCriterion | null) => void,
  ): void {
    const setting = new Setting(container).setName(label);
    let directionDropdown: DropdownComponent | null = null;

    setting.addDropdown((dropdown) => {
      dropdown.addOption("none", "None");
      for (const key of SORT_KEY_VALUES) dropdown.addOption(key, SORT_KEY_LABEL[key]);
      dropdown.setValue(getCurrent()?.key ?? "none");
      dropdown.onChange((value) => {
        const direction = getCurrent()?.direction ?? "ascending";
        setCurrent(value === "none" ? null : sortCriterion(value as SortKey, direction));
        directionDropdown?.setDisabled(value === "none");
      });
    });
    setting.addDropdown((dropdown) => {
      dropdown.addOption("ascending", "Ascending");
      dropdown.addOption("descending", "Descending");
      dropdown.setValue(getCurrent()?.direction ?? "ascending");
      dropdown.setDisabled(getCurrent() === null);
      dropdown.onChange((value) => {
        const key = getCurrent()?.key;
        if (key !== undefined) setCurrent(sortCriterion(key, value as SortDirection));
      });
      directionDropdown = dropdown;
    });
  }

  private renderRows(): void {
    const container = this.rowsContainer;
    if (container === null) return;
    container.empty();
    for (const row of this.rows) {
      this.renderRow(container, row);
    }
  }

  private renderRow(container: HTMLElement, draft: CriterionDraft): void {
    const rowEl = container.createDiv({ cls: "perlite-criterion-row" });

    const notLabel = rowEl.createEl("label", { cls: "perlite-criterion-row__not" });
    const notCheckbox = notLabel.createEl("input", { type: "checkbox" });
    notCheckbox.checked = draft.isNegated;
    notCheckbox.addEventListener("change", () => {
      draft.isNegated = notCheckbox.checked;
    });
    notLabel.appendText(" Not");

    const fieldSelect = rowEl.createEl("select");
    for (const field of CRITERION_FIELDS) {
      const option = fieldSelect.createEl("option", { value: field, text: CRITERION_FIELD_LABEL[field] });
      if (field === draft.field) option.selected = true;
    }
    const valueContainer = rowEl.createDiv({ cls: "perlite-criterion-row__value" });
    fieldSelect.addEventListener("change", () => {
      draft.field = fieldSelect.value as CriterionField;
      renderValueControl(valueContainer, draft);
    });
    renderValueControl(valueContainer, draft);

    const removeButton = rowEl.createEl("button", { text: "×", cls: "perlite-criterion-row__remove" });
    removeButton.addEventListener("click", () => {
      this.rows = this.rows.filter((r) => r.id !== draft.id);
      this.renderRows();
      this.refreshSaveEnabled();
    });
  }

  private refreshSaveEnabled(): void {
    if (this.saveButton === null) return;
    const canSave = this.name.trim().length > 0 && (this.unrepresentable || this.rows.length > 0);
    this.saveButton.disabled = !canSave;
  }

  private submit(): void {
    const trimmedName = this.name.trim();
    if (trimmedName.length === 0) return;
    if (!this.unrepresentable && this.rows.length === 0) return;

    const sorting: SortCriterion[] = [];
    if (this.primarySort !== null) sorting.push(this.primarySort);
    if (this.secondarySort !== null) sorting.push(this.secondarySort);

    // A kanban board needs *some* column key; default silently to Status rather than
    // blocking Save on a separate required-field validation, matching this modal's
    // existing permissive style elsewhere (e.g. an empty icon falls back to "flag" just
    // below).
    const grouping = this.lens === "kanban" && this.grouping === null ? "status" : this.grouping;

    const list = createSmartList({
      id: this.existing?.id ?? `user.${makeListID()}`,
      name: trimmedName,
      icon: this.icon.trim().length > 0 ? this.icon.trim() : "flag",
      accentToken: this.accentToken,
      filter: this.unrepresentable ? this.existing!.filter : flatFilterToExpression({ mode: this.matchMode, rows: this.rows } satisfies FlatFilter),
      grouping,
      sorting,
      isBuiltIn: this.existing?.isBuiltIn ?? false,
      lens: this.lens,
    });
    this.onSubmit(list);
    this.close();
  }
}

function makeListID(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function renderIconPreview(el: HTMLElement, iconName: string): void {
  el.empty();
  if (iconName.trim().length === 0) return;
  setIcon(el, iconName.trim());
}

function renderValueControl(container: HTMLElement, draft: CriterionDraft): void {
  container.empty();
  switch (draft.field) {
    case "status": {
      const select = container.createEl("select");
      for (const option of STATUS_KIND_OPTIONS) {
        const el = select.createEl("option", { value: option.value, text: option.label });
        if (option.value === draft.statusKind) el.selected = true;
      }
      select.addEventListener("change", () => {
        draft.statusKind = select.value as TaskStatusKind;
      });
      return;
    }
    case "priority": {
      const select = container.createEl("select");
      for (const value of PRIORITY_VALUES) {
        const el = select.createEl("option", { value, text: PRIORITY_LABEL[value] });
        if (value === draft.priority) el.selected = true;
      }
      select.addEventListener("change", () => {
        draft.priority = select.value as Priority;
      });
      return;
    }
    case "dueDate":
    case "scheduledDate":
    case "startDate":
    case "doneDate":
      renderDateRangeControl(container, draft);
      return;
    case "tagExact":
    case "tagContains":
    case "pathContains":
    case "textContains": {
      const input = container.createEl("input", { type: "text", value: draft.text });
      input.placeholder = draft.field === "tagExact" || draft.field === "tagContains" ? "#tag" : "text";
      input.addEventListener("input", () => {
        draft.text = input.value;
      });
      return;
    }
    case "hasDescription": {
      const select = container.createEl("select");
      const yes = select.createEl("option", { value: "true", text: "Yes" });
      const no = select.createEl("option", { value: "false", text: "No" });
      (draft.boolValue ? yes : no).selected = true;
      select.addEventListener("change", () => {
        draft.boolValue = select.value === "true";
      });
      return;
    }
  }
}

function renderDateRangeControl(container: HTMLElement, draft: CriterionDraft): void {
  const kindSelect = container.createEl("select");
  for (const kind of DATE_RANGE_KINDS) {
    const el = kindSelect.createEl("option", { value: kind, text: DATE_RANGE_KIND_LABEL[kind] });
    if (kind === draft.dateRangeKind) el.selected = true;
  }
  const operandsEl = container.createDiv();
  kindSelect.addEventListener("change", () => {
    draft.dateRangeKind = kindSelect.value as DateRangeKind;
    renderDateRangeOperands(operandsEl, draft);
  });
  renderDateRangeOperands(operandsEl, draft);
}

function renderDateRangeOperands(container: HTMLElement, draft: CriterionDraft): void {
  container.empty();
  switch (draft.dateRangeKind) {
    case "none":
      return;
    case "before":
    case "onOrAfter": {
      const input = container.createEl("input", { type: "date", value: calendarDateToISOString(draft.date) });
      input.addEventListener("change", () => {
        const parsed = parseCalendarDate(input.value);
        if (parsed !== null) draft.date = parsed;
      });
      return;
    }
    case "between": {
      const startInput = container.createEl("input", { type: "date", value: calendarDateToISOString(draft.rangeStart) });
      startInput.addEventListener("change", () => {
        const parsed = parseCalendarDate(startInput.value);
        if (parsed !== null) draft.rangeStart = parsed;
      });
      container.createSpan({ text: " to " });
      const endInput = container.createEl("input", { type: "date", value: calendarDateToISOString(draft.rangeEnd) });
      endInput.addEventListener("change", () => {
        const parsed = parseCalendarDate(endInput.value);
        if (parsed !== null) draft.rangeEnd = parsed;
      });
      return;
    }
    case "relative": {
      const select = container.createEl("select");
      for (const value of RELATIVE_DATE_RANGES) {
        const el = select.createEl("option", { value, text: RELATIVE_DATE_RANGE_LABEL[value] });
        if (value === draft.relativeRange) el.selected = true;
      }
      select.addEventListener("change", () => {
        draft.relativeRange = select.value as (typeof RELATIVE_DATE_RANGES)[number];
      });
      return;
    }
  }
}
