'use client'

// Tiny client island: the only interactive part of the print page. Never
// auto-prints on load — the volunteer chooses when to open the print dialog.
// Hidden from the printed output itself via the `print:hidden` utility.
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white print:hidden"
    >
      🖨 列印
    </button>
  )
}
