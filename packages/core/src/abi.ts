import { toEventSelector, type AbiEvent } from 'viem';
import { eventTableName } from './naming.js';

export class AbiError extends Error {}

export interface EventDef {
  contractName: string;
  address: `0x${string}`;
  event: AbiEvent;
  topic0: `0x${string}`;
  tableName: string;
}

export function extractEventDefs(
  contractName: string,
  address: string,
  abi: unknown,
  selectedEvents?: string[],
): EventDef[] {
  if (!Array.isArray(abi)) {
    throw new AbiError(`${contractName}: ABI must be a JSON array`);
  }
  const events = abi.filter(
    (e): e is AbiEvent => (e as { type?: string } | null)?.type === 'event',
  );
  if (selectedEvents?.length) {
    for (const name of selectedEvents) {
      if (!events.some((e) => e.name === name)) {
        throw new AbiError(`${contractName}: event '${name}' not found in ABI`);
      }
    }
  }
  const wanted = selectedEvents?.length
    ? events.filter((e) => selectedEvents.includes(e.name))
    : events;
  const nameCounts = new Map<string, number>();
  for (const e of wanted) nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
  return wanted.map((event) => {
    const topic0 = toEventSelector(event);
    const overloaded = (nameCounts.get(event.name) ?? 0) > 1;
    return {
      contractName,
      address: address.toLowerCase() as `0x${string}`,
      event,
      topic0,
      tableName: eventTableName(contractName, event.name, overloaded ? topic0 : undefined),
    };
  });
}
