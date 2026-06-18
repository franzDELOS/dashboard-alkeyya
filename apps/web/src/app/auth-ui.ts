// Shared Tailwind class strings for the auth pages, so every form inherits the
// same brand-token styling (Ink / Signal / Paper / Slate / Amber) without each
// component re-inventing it. Pure strings — safe to import anywhere.

export const labelClass = "block text-sm font-medium text-ink";

export const inputClass =
  "mt-1 w-full rounded-lg border border-ink/15 bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-1 focus:ring-signal";

export const buttonClass =
  "w-full rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

export const linkClass =
  "font-medium text-signal underline-offset-2 hover:underline";

// Errors borrow the brand's amber (the same hue status-board uses for "down").
export const errorClass = "text-sm text-amber";

export const successClass = "text-sm text-ink";

export const fieldWrapClass = "block";
