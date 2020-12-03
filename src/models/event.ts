/**
 * Stream event type.
 */
interface StreamEvent<MetaData> {
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
export type ApiStreamEvent = StreamEvent<StreamEventMetaData>;

/**
 * Type for event creation (event without values automatically assigned by the client).
 */
export type ClientStreamEvent = StreamEvent<Pick<StreamEventMetaData, "consentLevels">>;
