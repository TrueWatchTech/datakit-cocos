import type { FTRUMContext } from './types.js';

export interface FTReplayImageRecord {
  context: FTRUMContext;
  resourceId: string;
  width: number;
  height: number;
  mimeType?: `image/${string}`;
  timestamp: number;
  contextChanged: boolean;
  pointerEvents?: FTReplayPointerRecord[];
}

export interface FTReplayPointerRecord {
  eventType: 'down' | 'up' | 'move';
  pointerId: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface FTReplayPointerRecords {
  context: FTRUMContext;
  pointerEvents: FTReplayPointerRecord[];
}

export function encodeReplayImageRecord(input: FTReplayImageRecord): {
  segment: string;
  recordCount: number;
} {
  const wireframe = {
    id: 1,
    type: 'image',
    x: 0,
    y: 0,
    width: input.width,
    height: input.height,
    base64: null,
    border: null,
    clip: null,
    isEmpty: false,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    resourceId: input.resourceId,
    shapeStyle: null,
  };
  const records: unknown[] = [];
  if (input.contextChanged) {
    records.push(
      { type: 4, data: { width: input.width, height: input.height }, timestamp: input.timestamp },
      { type: 6, data: { has_focus: true }, timestamp: input.timestamp },
    );
  }
  records.push({
    type: 10,
    data: { wireframes: [wireframe] },
    timestamp: input.timestamp,
  });
  records.push(...input.pointerEvents?.map(pointerRecord) || []);
  return {
    segment: encodeEnvelope(input.context, records),
    recordCount: records.length,
  };
}

export function encodeReplayPointerRecords(input: FTReplayPointerRecords): {
  segment: string;
  recordCount: number;
} {
  const records = input.pointerEvents.map(pointerRecord);
  return {
    segment: encodeEnvelope(input.context, records),
    recordCount: records.length,
  };
}

function pointerRecord(pointer: FTReplayPointerRecord): unknown {
  return {
    type: 11,
    data: {
      source: 9,
      pointerEventType: pointer.eventType,
      pointerType: 'touch',
      pointerId: pointer.pointerId,
      x: pointer.x,
      y: pointer.y,
    },
    timestamp: pointer.timestamp,
  };
}

function encodeEnvelope(context: FTRUMContext, records: unknown[]): string {
  return JSON.stringify({
    records,
    applicationID: context.applicationId,
    sessionID: context.sessionId,
    viewID: context.viewId,
  });
}
