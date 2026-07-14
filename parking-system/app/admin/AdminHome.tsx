// Back-office home (Slice 3.5 follow-up): navigation now lives in the persistent
// sidebar (AdminSidebar), so /admin is a light welcome instead of a nav card grid.
export default function AdminHome({ username }: { username: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-3 bg-page px-6 py-10 text-ink">
      <h1 className="text-2xl font-bold tracking-tight">管理後台</h1>
      <p className="text-muted">歡迎，{username}。請從選單選擇要處理的項目。</p>
    </main>
  )
}
