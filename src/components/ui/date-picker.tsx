"use client"

import * as React from "react"
import { CalendarDaysIcon, XIcon } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  formatDateInput,
  formatDateOnly,
  parseDateInput,
  parseDateOnly,
  todayDateOnly,
} from "@/lib/date-only"

const INVALID_DATE_MESSAGE = "กรุณาระบุวันที่ให้ถูกต้องในรูปแบบ dd/MM/yyyy (พ.ศ.)"

export type DatePickerProps = {
  id: string
  value: string
  onChange: (iso: string) => void
  required?: boolean
  disabled?: boolean
  "aria-invalid"?: boolean | "false" | "true"
  "aria-describedby"?: string
  className?: string
  placeholder?: string
}

function DatePicker({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
  className,
  placeholder = "dd/MM/yyyy (พ.ศ.)",
}: DatePickerProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const editingRef = React.useRef(false)
  const invalidDraftRef = React.useRef(false)
  const lastValueRef = React.useRef(value)
  const [draft, setDraft] = React.useState(() => formatDateInput(value))
  const [invalid, setInvalid] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState<Date>(() => {
    return parseDateOnly(value) ?? parseDateOnly(todayDateOnly()) ?? new Date()
  })

  React.useEffect(() => {
    if (value === lastValueRef.current) return
    lastValueRef.current = value
    if (editingRef.current || invalidDraftRef.current) return

    setDraft(formatDateInput(value))
    setInvalid(false)
    const nextMonth = parseDateOnly(value)
    if (nextMonth) setMonth(nextMonth)
  }, [value])

  const commit = React.useCallback(
    (iso: string) => {
      lastValueRef.current = iso
      invalidDraftRef.current = false
      inputRef.current?.setCustomValidity("")
      setInvalid(false)
      setDraft(formatDateInput(iso))
      onChange(iso)
    },
    [onChange]
  )

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.target.value
    setDraft(nextDraft)

    const parsed = parseDateInput(nextDraft)
    if (parsed) {
      event.currentTarget.setCustomValidity("")
      invalidDraftRef.current = false
      setInvalid(false)
      commit(parsed)
    } else if (nextDraft.trim() === "" && !required) {
      event.currentTarget.setCustomValidity("")
      invalidDraftRef.current = false
      setInvalid(false)
      lastValueRef.current = ""
      onChange("")
    } else {
      event.currentTarget.setCustomValidity(INVALID_DATE_MESSAGE)
      invalidDraftRef.current = true
      setInvalid(true)
      lastValueRef.current = ""
      onChange("")
    }
  }

  const handleBlur = () => {
    editingRef.current = false
    const parsed = parseDateInput(draft)
    if (parsed) {
      inputRef.current?.setCustomValidity("")
      commit(parsed)
      return
    }

    if (draft.trim() === "" && !required) {
      inputRef.current?.setCustomValidity("")
      lastValueRef.current = ""
      invalidDraftRef.current = false
      setInvalid(false)
      setDraft("")
      onChange("")
      return
    }

    // Clear the model when a draft is invalid. Keep the draft visible so the
    // user can correct it, even if a parent guards against clearing required fields.
    invalidDraftRef.current = true
    lastValueRef.current = ""
    inputRef.current?.setCustomValidity(INVALID_DATE_MESSAGE)
    setInvalid(true)
    onChange("")
  }

  const handleNativeInvalid = (event: React.InvalidEvent<HTMLInputElement>) => {
    invalidDraftRef.current = true
    setInvalid(true)
    event.currentTarget.setCustomValidity(INVALID_DATE_MESSAGE)
  }

  const handleSelect = (date: Date | undefined) => {
    if (!date) return
    const iso = formatDateOnly(date)
    inputRef.current?.setCustomValidity("")
    commit(iso)
    setMonth(date)
    setOpen(false)
    inputRef.current?.focus()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      const selected = parseDateOnly(value)
      setMonth(selected ?? parseDateOnly(todayDateOnly()) ?? new Date())
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!disabled) setOpen(true)
    } else if (event.key === "Escape" && open) {
      event.preventDefault()
      setOpen(false)
      inputRef.current?.focus()
    }
  }

  const hasExternalInvalid = ariaInvalid === true || ariaInvalid === "true"
  const errorId = `${id}-error`
  const describedBy = [ariaDescribedby, invalid ? errorId : undefined].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("min-w-0", className)} data-invalid={invalid ? "" : undefined}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <div className="relative min-w-0">
          <input
            ref={inputRef}
            id={id}
            type="text"
            inputMode="numeric"
            value={draft}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            aria-invalid={invalid || hasExternalInvalid ? true : undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            className={cn(
              "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 pr-12 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground/55 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
              !required && draft && "pr-24"
            )}
            onFocus={() => {
              editingRef.current = true
              invalidDraftRef.current = false
            }}
            onChange={handleInputChange}
            onBlur={handleBlur}
            onInvalid={handleNativeInvalid}
            onKeyDown={handleKeyDown}
          />
          {!required && draft && (
            <button
              type="button"
              className="absolute top-0 right-11 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-label="ล้างวันที่"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                commit("")
                inputRef.current?.focus()
              }}
            >
              <XIcon aria-hidden="true" />
            </button>
          )}
          <PopoverTrigger asChild>
            <button
              type="button"
              className="absolute top-0 right-0 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
              aria-label="เปิดปฏิทิน"
              disabled={disabled}
            >
              <CalendarDaysIcon aria-hidden="true" />
            </button>
          </PopoverTrigger>
        </div>
        <PopoverContent
          align="start"
          className="w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-x-auto p-2 sm:p-3"
        >
          <Calendar
            mode="single"
            selected={parseDateOnly(value) ?? undefined}
            month={month}
            onMonthChange={setMonth}
            onSelect={handleSelect}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {invalid && (
        <p id={errorId} className="mt-1 text-sm text-destructive">
          {INVALID_DATE_MESSAGE}
        </p>
      )}
    </div>
  )
}

export { DatePicker }
export default DatePicker
