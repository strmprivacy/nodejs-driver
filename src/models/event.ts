/**
 * Stream event type.
 */
interface GenericStreamEvent<MetaData> {
  abTests: string[];
  eventType: string;
  customer: { id: string };
  referrer: string;
  userAgent: string;
  producerSessionId: string;
  conversion: number;
  url: string;
  strmMeta: MetaData;
}

/**
 * Stream event meta data type.
 */
interface StreamEventMetaData {
  schemaId: string;
  nonce: number;
  timestamp: number;
  consentLevels: number[];
}

/**
 * Type that represents the full event.
 */
export type ApiStreamEvent = GenericStreamEvent<StreamEventMetaData>;

/**
 * Type for event creation (event without values automatically assigned by the client).
 */
export type ClientStreamEvent = GenericStreamEvent<Pick<StreamEventMetaData, "consentLevels">>;
