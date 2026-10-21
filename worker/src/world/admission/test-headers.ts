import { flags } from '@gtasf/shared/flags';
import { ADMISSION_PROTOCOL_PREFIX } from '@gtasf/shared/admission';
import { PROTOCOL_SUBPROTOCOL } from '@gtasf/shared/protocol/constants';
import { secretToken } from './http';

/** Existing world lifecycle fixtures use the same private reservation boundary as LobbyDO. */
export async function worldTestHeaders(stub: DurableObjectStub): Promise<Record<string, string>> {
  let protocol: string = PROTOCOL_SUBPROTOCOL;
  if (flags.worldCapacity) {
    const response = await stub.fetch('https://test/internal/admission/reserve', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: secretToken() }) });
    const result = await response.json<{ grant?: string }>();
    if (!response.ok || !result.grant) throw new Error('Fixture admission failed');
    protocol += `, ${ADMISSION_PROTOCOL_PREFIX}${result.grant}`;
  }
  return { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': protocol };
}
