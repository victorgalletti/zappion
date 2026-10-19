// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT, getLocale } from "@/lib/i18n";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  id?: string;
  name?: string;
  required?: boolean;
  title?: string;
  size?: "form" | "compact";
  className?: string;
};

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(getLocale().locale);

export function Select({ value, onChange, options, placeholder, disabled = false,
  size = "form", className, id, name, required, title, ...aria }: SelectProps) {
  const t = useT();
  const generatedId = useId();
  const buttonId = id ?? `select-${generatedId}`;
  const listId = `${buttonId}-listbox`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 320 });
  const selected = options.find((option) => option.value === value);
  const enabledIndexes = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const active = options[activeIndex] && !options[activeIndex].disabled ? activeIndex : (enabledIndexes[0] ?? -1);
  const visible = open && !disabled;
  const hasValue = Boolean(value && selected && !selected.disabled);

  function close(restoreFocus = true) {
    setOpen(false);
    searchRef.current = { text: "", time: 0 };
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }

  function show(index?: number) {
    if (disabled) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(index ?? (selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? -1)));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setInvalid(false);
    close();
  }

  // The list is portaled, so ancestor overflow cannot clip it. Reposition on
  // scrolling/resizing and measure the actual content before choosing a side.
  useLayoutEffect(() => {
    if (!visible) return;
    function updatePosition() {
      const button = buttonRef.current;
      const list = listRef.current;
      if (!button || !list) return;
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const margin = 8;
      const gap = 6;
      const below = Math.max(0, viewportBottom - rect.bottom - gap - margin);
      const above = Math.max(0, rect.top - viewportTop - gap - margin);
      const desiredHeight = Math.min(320, list.scrollHeight + 2);
      const upwards = below < desiredHeight && above > below;
      const maxHeight = Math.min(320, upwards ? above : below);
      const height = Math.min(desiredHeight, maxHeight);
      const width = Math.min(Math.max(rect.width, 200), viewportWidth - margin * 2);
      setPosition({
        left: Math.max(viewportLeft + margin, Math.min(rect.left, viewportLeft + viewportWidth - width - margin)),
        top: upwards ? Math.max(viewportTop + margin, rect.top - gap - height) : rect.bottom + gap,
        width,
        maxHeight,
      });
    }
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    if (buttonRef.current) observer.observe(buttonRef.current);
    if (listRef.current) observer.observe(listRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [visible, options]);

  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close();
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focusOutside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", focusOutside);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || active < 0) return;
    const list = listRef.current;
    const item = list?.children[active] as HTMLElement | undefined;
    if (!list || !item) return;
    // Scroll only the list, without moving the page or the trigger's container.
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  }, [visible, active]);

  useEffect(() => {
    if (disabled) setOpen(false);
    if (hasValue || disabled) setInvalid(false);
  }, [disabled, hasValue]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Tab") { close(false); return; }
    if (event.key === "Escape") {
      if (visible) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const last = enabledIndexes.at(-1) ?? -1;
      if (event.key === "Home") { show(enabledIndexes[0] ?? -1); return; }
      if (event.key === "End") { show(last); return; }
      if (!visible) { show(event.key === "ArrowUp" && !selected ? last : undefined); return; }
      const current = enabledIndexes.indexOf(active);
      const next = event.key === "ArrowDown" ? Math.min(current + 1, enabledIndexes.length - 1) : Math.max(current - 1, 0);
      setActiveIndex(enabledIndexes[next] ?? -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (visible) choose(active); else show();
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - searchRef.current.time < 700 ? searchRef.current.text : "";
      const text = previous + normalize(event.key);
      searchRef.current = { text, time: now };
      const prefix = [...text].every((letter) => letter === text[0]) ? text[0] : text;
      const start = visible ? active : options.findIndex((option) => option.value === value);
      const ordered = [...enabledIndexes.filter((index) => index > start), ...enabledIndexes.filter((index) => index <= start)];
      if (prefix.length > 1 && start >= 0) ordered.unshift(start);
      const match = ordered.find((index) => !options[index].disabled && normalize(options[index].label).startsWith(prefix));
      if (match !== undefined) { show(match); } else if (!visible) show();
    }
  }

  return <>
    <button ref={buttonRef} id={buttonId} type="button" role="combobox" aria-haspopup="listbox"
      aria-expanded={visible} aria-controls={visible ? listId : undefined}
      aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
      aria-required={required || undefined} aria-invalid={invalid || undefined}
      {...aria} disabled={disabled} title={title} onKeyDown={onKeyDown}
      onClick={() => visible ? close() : show()}
      className={cn("inline-flex min-w-0 items-center justify-between gap-2 border border-line bg-input text-left text-heading hover:border-accent/50 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50",
        size === "compact" ? "max-w-full rounded-full px-3 py-1.5 text-xs" : "w-full rounded-xl px-3 py-2.5 text-sm",
        invalid && "border-danger", className)}>
      <span className={cn("min-w-0 truncate", !selected && "text-sub")}>{selected?.label ?? placeholder ?? t.select.selectAnOption}</span>
      <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-icon transition-transform", visible && "rotate-180")} />
    </button>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    {/* Hidden inputs are excluded from native constraint validation. A separate
        unnamed proxy blocks invalid submissions and focuses the combobox. */}
    {required && <input type="text" className="sr-only" tabIndex={-1} aria-hidden="true" required disabled={disabled}
      value={hasValue ? value : ""} onChange={() => {}} onInvalid={(event) => {
        event.preventDefault(); setInvalid(true); buttonRef.current?.focus(); show();
      }} />}
    {visible && createPortal(
      <div ref={listRef} id={listId} role="listbox" aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-label"] ? undefined : (aria["aria-labelledby"] ?? buttonId)}
        style={position} className="thin-scroll fixed z-50 overflow-y-auto rounded-xl border border-line bg-menu p-1.5 text-heading shadow-lg"
        onPointerDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
          aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
          onClick={() => choose(index)}
          className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm",
            option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-panel",
            !option.disabled && active === index && "bg-panel")}>
          <span className="min-w-0 flex-1 break-words"><span className="block">{option.label}</span>
            {option.description && <span className="mt-0.5 block text-xs text-sub">{option.description}</span>}
          </span>
          <span className="size-4 shrink-0">{option.value === value && <Check aria-hidden="true" className="size-4 text-accent" />}</span>
        </div>)}
        {!options.length && <p className="px-3 py-2.5 text-sm text-sub">{t.select.noOptionsAvailable}</p>}
      </div>, document.body,
    )}
  </>;
}
