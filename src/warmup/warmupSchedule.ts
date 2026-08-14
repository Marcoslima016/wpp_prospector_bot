export interface WarmupScheduleConfig {
  /** Days from activation until the number reaches its full allotment. */
  warmupDays: number;
  /** Fraction of the full allotment allowed on day 0 (0 < startFraction <= 1). */
  startFraction: number;
}

const DEFAULT_CONFIG: WarmupScheduleConfig = {
  warmupDays: 14,
  startFraction: 0.1,
};

/**
 * Computes how many messages a single number is allowed to send on a given
 * day of its warmup, ramping linearly from `startFraction` of its full
 * allotment on day 0 up to the full allotment once `warmupDays` have passed.
 */
export class WarmupSchedule {
  private readonly config: WarmupScheduleConfig;

  constructor(config: Partial<WarmupScheduleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * @param daysSinceActivation 0 on the day the number was first paired.
   * @param fullAllotment the number's target daily volume once fully warmed up.
   */
  allowedVolume(daysSinceActivation: number, fullAllotment: number): number {
    if (daysSinceActivation < 0) {
      throw new RangeError('daysSinceActivation must not be negative');
    }
    if (daysSinceActivation >= this.config.warmupDays) {
      return fullAllotment;
    }

    const startVolume = Math.max(1, Math.round(fullAllotment * this.config.startFraction));
    const progress = daysSinceActivation / this.config.warmupDays;
    const ramped = startVolume + (fullAllotment - startVolume) * progress;
    return Math.min(fullAllotment, Math.round(ramped));
  }
}
