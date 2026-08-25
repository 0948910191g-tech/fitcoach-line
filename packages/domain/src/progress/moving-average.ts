export interface TimedValue {
  at: string | Date;
  value: number;
}

export interface MovingAveragePoint {
  date: string;
  storageValue: number;
  displayValue: number;
  sampleDays: number;
}

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const DAY_MS = 86_400_000;
const bangkokDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BANGKOK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function roundStorage(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function bangkokDateKey(input: string | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('at must be a valid timestamp');
  }
  const parts = bangkokDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('unable to resolve Asia/Bangkok date');
  }
  return `${year}-${month}-${day}`;
}

function calendarDay(dateKey: string): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  return Math.trunc(Date.UTC(year, month - 1, day) / DAY_MS);
}

function displayRound(value: number): number {
  return Math.round(value * 10) / 10;
}

export function movingAverage7d(readings: readonly TimedValue[]): MovingAveragePoint[] {
  const grouped = new Map<string, number[]>();

  for (const reading of readings) {
    if (!Number.isFinite(reading.value)) {
      throw new RangeError('value must be finite');
    }
    const key = bangkokDateKey(reading.at);
    const values = grouped.get(key) ?? [];
    values.push(reading.value);
    grouped.set(key, values);
  }

  const daily = [...grouped.entries()]
    .map(([date, values]) => ({
      date,
      day: calendarDay(date),
      value: roundStorage(values.reduce((total, value) => total + value, 0) / values.length),
    }))
    .sort((a, b) => a.day - b.day);

  return daily.map((current) => {
    const startDay = current.day - 6;
    const window = daily.filter((point) => point.day >= startDay && point.day <= current.day);
    const storageValue = roundStorage(window.reduce((total, point) => total + point.value, 0) / window.length);

    return {
      date: current.date,
      storageValue,
      displayValue: displayRound(storageValue),
      sampleDays: window.length,
    };
  });
}
