type PendingOverlayProps = {
  show: boolean;
  label?: string;
};

export function PendingOverlay({ show, label }: PendingOverlayProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/90 px-5 py-3 text-sm font-semibold text-foreground shadow-xl">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/40 border-t-transparent" />
        <span>{label ?? "진행 중..."}</span>
      </div>
    </div>
  );
}
