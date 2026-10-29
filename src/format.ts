export function formatHours(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

export function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
