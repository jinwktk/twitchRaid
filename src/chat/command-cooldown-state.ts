/**
 * コマンドクールダウン状態管理
 */
export class CommandCooldownState {
  private readonly times: Map<string, number>;

  constructor(initialTimes: Record<string, number> = {}) {
    this.times = new Map(Object.entries(initialTimes));
  }

  lastUsed(command: string): number | null {
    return this.times.get(command) ?? null;
  }

  markUsed(command: string, now: number): void {
    this.times.set(command, now);
  }

  remainingSeconds(
    command: string,
    currentTime: number,
    cooldownSeconds: number
  ): number {
    const last = this.times.get(command);
    if (last === undefined) return 0;
    const elapsed = currentTime - last;
    const remaining = cooldownSeconds - elapsed;
    return remaining > 0 ? Math.floor(remaining) : 0;
  }
}
