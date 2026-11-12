/** "1 fee", "2 fees": counts written the way people read them. */
export function pl(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
